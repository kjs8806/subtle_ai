// FEATURE-003: computed-at-read-time renewal certainty and bucketing. Pure
// domain logic - no I/O. Unlike PriceChangeService, nothing here is
// persisted: "days until renewal" changes every day with no new evidence
// arriving, so there is nothing to durably "detect once" the way a price
// change is a discrete fact tied to one piece of evidence. Idempotency is
// satisfied by construction - nothing is ever created, so nothing can be
// duplicated.
const VALID_CADENCES = new Set(['monthly', 'yearly'])
const CONFIRMED_PROVENANCE = new Set(['confirmed', 'user_confirmed'])
const DAY_MS = 24 * 60 * 60 * 1000
// Guards the inference forward-loop against ever spinning unboundedly on
// pathological input (e.g. a corrupted billed_at far in the past) - 1200
// monthly cycles is 100 years, far beyond any realistic staleness.
const MAX_CADENCE_STEPS = 1200

// next_renewal is a loosely-formatted string extracted from email text (see
// migrations/006_feature_001_next_renewal_text.sql) - never a validated
// calendar date. Only two explicit, unambiguous shapes are trusted: an ISO
// 'YYYY-MM-DD' date (as FEATURE-002 corrections store it) and the
// "Mon D, YYYY" shape the receipt parser extracts (see
// src/services/receiptPipeline.js's DATE_PATTERN). Both are parsed by
// explicitly building a UTC date from the matched components - never via
// `new Date(arbitraryString)`, whose non-ISO parsing is timezone- and
// engine-dependent (a bare "Jan 5, 2026" would parse as *local* midnight,
// which can land on a different UTC calendar day depending on the server's
// timezone). Anything else - including a string with no explicit year, which
// would otherwise let a parser silently assume the current year - is treated
// as unparseable, falling through to inference/unknown rather than
// fabricating a bucket. Same "never fabricate" principle that migration
// already established for storage.
const MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MONTH_DAY_YEAR = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(\d{4})$/

// Date.UTC silently *normalizes* an impossible calendar date instead of
// rejecting it (e.g. 2026-02-30 rolls into March 2, 2026-13-01's regex-
// captured "13" becomes month index 12 -> January 2027) - a round-trip check
// against the components that were actually matched is required to catch
// this, since a normalized-but-wrong date is exactly the kind of fabrication
// this parser exists to prevent.
const buildUtcDate = (year, monthIndex, day) => {
  const date = new Date(Date.UTC(year, monthIndex, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null
  return date
}

const parseLooseDate = (text) => {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (!trimmed) return null
  const isoMatch = trimmed.match(ISO_DATE)
  if (isoMatch) {
    const [, year, month, day] = isoMatch
    return buildUtcDate(Number(year), Number(month) - 1, Number(day))
  }
  const monthMatch = trimmed.match(MONTH_DAY_YEAR)
  if (monthMatch) {
    const [, monthName, day, year] = monthMatch
    const monthIndex = MONTH_INDEX[monthName.slice(0, 3).toLowerCase()]
    if (monthIndex === undefined) return null
    return buildUtcDate(Number(year), monthIndex, Number(day))
  }
  return null
}

const dateOnlyUTC = (date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
const daysBetween = (later, earlier) => Math.round((dateOnlyUTC(later) - dateOnlyUTC(earlier)) / DAY_MS)
const toISODate = (date) => new Date(dateOnlyUTC(date)).toISOString().slice(0, 10)

const addCadencePeriod = (date, cadence) => {
  const next = new Date(date.getTime())
  if (cadence === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1)
  else next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next
}

// Product's fixed look-ahead table: >30 days = no attention item (Subscription
// Detail only), 8-30 = upcoming, 1-7 = soon, 0 = due_today. Never an
// alarmist label like "Urgent". Only ever called with a non-negative
// daysUntil: the confirmed path no longer returns a stale (already-passed)
// date here, and the inferred path's forward-projection loop guarantees its
// candidate is never before `now`.
const bucketFor = (daysUntil) => {
  if (daysUntil > 30) return null
  if (daysUntil >= 8) return 'upcoming'
  if (daysUntil >= 1) return 'soon'
  return 'due_today'
}

// A renewal date is "confirmed" only when the currently-stored next_renewal
// text traces back to confirmed evidence or an explicit FEATURE-002
// correction (which is inherently user-confirmed) - never merely because the
// column happens to be non-null. This mirrors the fact/inference/correction
// separation FEATURE-001/002 already established, without re-implementing
// correction precedence: subscriptions.next_renewal already reflects the
// corrected value when one exists.
const hasConfirmedProvenance = (subscription) => {
  const activeCorrection = (subscription.corrections || []).some((correction) => correction.field === 'next_renewal')
  if (activeCorrection) return true
  const matchingObservations = (subscription.fieldObservations || [])
    .filter((observation) => observation.field === 'nextRenewal' && observation.value != null && String(observation.value) === String(subscription.nextRenewal))
  const latest = matchingObservations.at(-1)
  return Boolean(latest && CONFIRMED_PROVENANCE.has(latest.provenance))
}

export const RenewalDerivationService = {
  // derive({ subscription, billingHistory, now }) ->
  //   { certainty: 'confirmed'|'inferred'|'unknown', renewalDate: 'YYYY-MM-DD'|null, daysUntil: number|null, bucket: 'due_today'|'soon'|'upcoming'|null }
  // `bucket: null` means "more than 30 days away (or no supported prediction
  // at all)" - Subscription Detail only, no attention item.
  derive({ subscription, billingHistory, now = new Date() } = {}) {
    const nowDate = now instanceof Date ? now : new Date(now)
    const history = billingHistory || subscription?.billingHistory || []

    // 1. Confirmed: an explicit renewal date backed by confirmed/user_confirmed provenance.
    if (subscription?.nextRenewal && hasConfirmedProvenance(subscription)) {
      const parsedDate = parseLooseDate(subscription.nextRenewal)
      if (parsedDate) {
        const daysUntil = daysBetween(parsedDate, nowDate)
        // A confirmed date that has already passed is stale, not "due today"
        // forever - the Product Owner's table only defines 0 -> due_today,
        // never negative. Fall through to inference (step 2) or unknown
        // (step 3) instead of returning a fact that is no longer true.
        if (daysUntil >= 0) return { certainty: 'confirmed', renewalDate: toISODate(parsedDate), daysUntil, bucket: bucketFor(daysUntil) }
      }
      // An unparseable (or stale) date degrades to inference/unknown below,
      // exactly like an absent one - never thrown, never fabricated.
    }

    // 2. Inferred: cadence + the most recent real billing event, projected forward past `now`.
    const cadence = VALID_CADENCES.has(subscription?.billingCycle) ? subscription.billingCycle : null
    const validBilledDates = history
      .map((event) => (event?.billedAt ? new Date(event.billedAt) : null))
      .filter((date) => date && !Number.isNaN(date.getTime()))
    if (cadence && validBilledDates.length) {
      const lastBilledAt = validBilledDates.reduce((latest, date) => (date > latest ? date : latest))
      let candidate = addCadencePeriod(lastBilledAt, cadence)
      let steps = 0
      while (dateOnlyUTC(candidate) < dateOnlyUTC(nowDate) && steps < MAX_CADENCE_STEPS) {
        candidate = addCadencePeriod(candidate, cadence)
        steps += 1
      }
      const daysUntil = daysBetween(candidate, nowDate)
      return { certainty: 'inferred', renewalDate: toISODate(candidate), daysUntil, bucket: bucketFor(daysUntil) }
    }

    // 3. Unknown: missing certainty beats fabricated certainty - no renewal attention item.
    return { certainty: 'unknown', renewalDate: null, daysUntil: null, bucket: null }
  },
}
