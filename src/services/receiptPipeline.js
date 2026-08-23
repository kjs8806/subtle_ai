import { classifySubscriptionCandidate } from './subscriptionClassifier.js'
import { findSubscriptionTemplate } from './subscriptionTemplates.js'

const OVERLAP_PAIRS = new Set([
  ['Dropbox', 'Google One'].sort().join('|'),
  ['Disney+', 'YouTube Premium'].sort().join('|'),
])

// Deliberately broader than just "receipt/invoice/payment": a one-time
// transaction email (a shipping notice, a ride receipt) needs to reach the
// classifier and be explicitly rejected with a reason, not be silently
// dropped here as "not a receipt at all" - the two are different outcomes.
const RECEIPT_TERMS = /receipt|renewal|renewed|membership|invoice|subscription|trial|payment|order|shipped|purchase|booking|reservation|itinerary|ticket|\btrip\b|\bride\b|delivered/i
// Amount extraction recognizes only the currency markers FEATURE-001
// explicitly supports (USD/CAD) plus a bare `$`, which is currency-neutral -
// it never implies USD. An unrecognized marker (EUR, GBP, ...) simply doesn't
// match, so amount stays null rather than being extracted under a currency we
// don't support.
const AMOUNT_PATTERN = /(?:USD|US\$|CAD|CA\$|C\$|\$)\s?([0-9]+(?:\.[0-9]{2})?)/i
// Recognized only so an amount tagged with a currency FEATURE-001 doesn't
// support (EUR, GBP) is correctly withheld from automatic creation, the same
// as any other unresolved-currency amount, rather than silently falling
// through the "no amount found at all" path. EUR/GBP are never treated as a
// valid currency *value* anywhere - this is not multi-currency support, it's
// closing the gap that would otherwise let an unsupported-currency amount
// evade the currency gate below.
const UNSUPPORTED_CURRENCY_AMOUNT_PATTERN = /\b(?:EUR|GBP)\b\s?([0-9]+(?:\.[0-9]{2})?)/i
const USD_INDICATOR = /\bUSD\b|\bUS\$/i
const CAD_INDICATOR = /\bCAD\b|\bCA\$|\bC\$/i
const CADENCE_PATTERN = /(monthly|per month|\/month|annual|yearly|per year|\/year)/i
const DATE_PATTERN = /(?:next billing|renews?|renewal|billing date|due)[^\n]{0,20}?([A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i

// Amount and currency are extracted independently and deliberately never
// inferred from each other. A bare `$` (no USD/CAD marker anywhere in the
// message) resolves to currency: null - ambiguous, not USD. Seeing both
// indicators (a coincidental mention of both currencies) is exactly as
// unresolved as seeing neither, so it also resolves to null rather than
// guessing.
const extractAmountAndCurrency = (rawText) => {
  const amountMatch = rawText.match(AMOUNT_PATTERN) || rawText.match(UNSUPPORTED_CURRENCY_AMOUNT_PATTERN)
  const amount = amountMatch ? Number(amountMatch[1]) : null
  if (amount === null) return { amount: null, currency: null }
  const hasUsd = USD_INDICATOR.test(rawText)
  const hasCad = CAD_INDICATOR.test(rawText)
  const currency = hasUsd && !hasCad ? 'USD' : hasCad && !hasUsd ? 'CAD' : null
  return { amount, currency }
}

const confidenceFor = ({ merchant, amount, cadence, nextRenewal }) => {
  const signals = [merchant, amount, cadence, nextRenewal].filter(Boolean).length
  if (signals >= 4) return { score: 0.96, state: 'confirmed' }
  if (signals >= 2) return { score: 0.74, state: 'inferred' }
  return { score: 0.42, state: 'inferred' }
}

export const createEvidence = (data) => ({
  id: data.id,
  type: data.type,
  sourceId: data.sourceId,
  sourceLabel: data.sourceLabel,
  rawMerchant: data.rawMerchant,
  canonicalService: data.canonicalService,
  amount: data.amount,
  currency: data.currency ?? null,
  cadence: data.cadence,
  nextRenewal: data.nextRenewal,
  receivedAt: data.receivedAt,
  confidence: data.confidence,
  excerpt: data.excerpt,
  fieldObservations: data.fieldObservations || {},
  // Classification confidence (was this email a subscription at all?) is a
  // distinct concept from evidence confidence (how well do we know the
  // *fields* of a subscription we already accepted?) - kept separate rather
  // than folded into `confidence` so the two are never conflated.
  classificationScore: data.classificationScore ?? null,
})

export const createPriceObservation = ({ amount, currency = null, observedAt }) => ({ amount, currency, observedAt })

export const createBillingEvent = ({ amount, currency = null, billedAt }) => ({ amount, currency, billedAt })

export const createRecommendationEvidence = (evidenceIds = []) => evidenceIds.map((evidenceId) => ({ evidenceId }))

export const createRecommendation = (data) => ({
  ...data,
  evidenceIds: data.evidenceIds || [],
  evidence: createRecommendationEvidence(data.evidenceIds),
})

export const createSubscription = (data) => ({
  ...data,
  evidence: data.evidence || [],
  priceHistory: data.priceHistory || [],
  billingHistory: data.billingHistory || [],
  recommendations: data.recommendations || [],
})

// `sender` is a raw RFC 5322 From header (e.g. `"Anthropic, PBC"
// <invoice+statements@anthropic.com>`), not a bare email address. Prefer the
// quoted display name; fall back to the address's local part only when no
// display name is present.
const parseSenderName = (sender = '') => {
  const match = sender.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/)
  if (match) return match[1].trim() || match[2].split('@')[0]
  return sender.split('@')[0] || sender
}

export const normalizeMerchant = (rawMerchant = '') => {
  const template = findSubscriptionTemplate(rawMerchant, rawMerchant)
  return template
    ? { canonicalService: template.canonicalService, category: template.category }
    : { canonicalService: rawMerchant.trim() || 'Unknown service', category: 'Other' }
}

// parseReceipt classifies a candidate email before extracting any evidence
// fields (see docs/engineering/SUBSCRIPTION_CLASSIFICATION.md). It always
// returns an explicit result rather than overloading `null` for multiple
// meanings:
//
//   { classification: 'not_receipt' | 'one_time', evidence: null, classifierResult, candidate: null }
//   { classification: 'ambiguous', evidence: null, classifierResult, candidate: <candidate sketch> }
//   { classification: 'subscription', evidence: <evidence object>, classifierResult, candidate: null }
//
// Only 'subscription' carries an `evidence` object; callers must not persist
// anything as confirmed evidence for the other classifications. `candidate`
// (FEATURE-002) is a best-effort, non-authoritative sketch of the same fields
// for `ambiguous` results only - it exists so a pending review candidate can
// be persisted and shown to the user, and is never sufficient evidence for
// automatic subscription creation.
export const parseReceipt = ({ id, subject = '', sender = '', receivedAt, body = '' }) => {
  const rawText = `${subject}\n${sender}\n${body}`
  if (!RECEIPT_TERMS.test(rawText)) return { classification: 'not_receipt', evidence: null, classifierResult: null, candidate: null }

  const classifierResult = classifySubscriptionCandidate({ subject, sender, body })
  const merchant = classifierResult.canonicalService || parseSenderName(sender) || 'Unknown service'
  const rawMerchant = parseSenderName(sender) || merchant
  const { amount, currency } = extractAmountAndCurrency(rawText)
  const cadenceMatch = rawText.match(CADENCE_PATTERN)?.[1]?.toLowerCase()
  const cadence = cadenceMatch?.includes('year') || cadenceMatch === 'annual' ? 'yearly' : cadenceMatch ? 'monthly' : null
  const nextRenewal = rawText.match(DATE_PATTERN)?.[1] || null
  const buildCandidate = () => ({
    canonicalService: merchant,
    rawMerchant,
    amount,
    currency,
    cadence,
    nextRenewal,
    sourceId: id,
    receivedAt: receivedAt || null,
    excerpt: subject,
  })

  if (classifierResult.classification !== 'subscription') {
    return { classification: classifierResult.classification, evidence: null, classifierResult, candidate: classifierResult.classification === 'ambiguous' ? buildCandidate() : null }
  }

  // Currency is part of FEATURE-001's minimum evidence for automatic
  // creation (see docs/engineering/FEATURE_001_CURRENCY.md): an amount with
  // no resolvable CAD/USD currency is not fully confirmed evidence, even
  // though the recurrence language alone was strong enough to classify this
  // as a subscription. Never fabricate a currency to get past this gate -
  // fall back to the same ambiguous/insufficient-evidence path already used
  // for weak recurrence signals, so the scan contract stays a single shape.
  if (amount !== null && currency === null) {
    return { classification: 'ambiguous', evidence: null, classifierResult, candidate: buildCandidate() }
  }
  const confidence = confidenceFor({ merchant: classifierResult.canonicalService, amount, cadence, nextRenewal })
  const fieldObservations = {
    canonicalService: { value: merchant, provenance: classifierResult.canonicalService ? 'confirmed' : 'inferred' },
    amount: { value: amount, provenance: amount === null ? 'inferred' : 'confirmed' },
    currency: { value: currency, provenance: currency ? 'confirmed' : 'inferred' },
    cadence: { value: cadence, provenance: cadence ? 'confirmed' : 'inferred' },
    nextRenewal: { value: nextRenewal, provenance: nextRenewal ? 'confirmed' : 'inferred' },
  }

  const evidence = createEvidence({
    id: `evidence-${id}`,
    type: 'gmail_receipt',
    sourceId: id,
    sourceLabel: 'Gmail receipt',
    rawMerchant,
    canonicalService: merchant,
    amount,
    currency,
    cadence,
    nextRenewal,
    receivedAt: receivedAt || null,
    confidence,
    fieldObservations,
    excerpt: subject,
    classificationScore: classifierResult.score,
  })

  return { classification: 'subscription', evidence, classifierResult, candidate: null }
}

export const createSubscriptionRecord = (evidence, overrides = {}) => {
  if (!evidence) return null
  const normalized = normalizeMerchant(evidence.canonicalService || evidence.rawMerchant)
  return createSubscription({
    id: overrides.id || evidence.canonicalService.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    canonicalService: normalized.canonicalService,
    rawMerchant: evidence.rawMerchant,
    plan: overrides.plan || 'Unknown plan',
    currentPrice: overrides.currentPrice ?? evidence.amount,
    currency: overrides.currency ?? evidence.currency ?? null,
    billingCycle: overrides.billingCycle || evidence.cadence || 'unknown',
    nextRenewal: overrides.nextRenewal || evidence.nextRenewal,
    status: overrides.status || 'active',
    confidence: overrides.confidence || evidence.confidence,
    source: evidence.sourceLabel,
    evidence: [evidence],
    priceHistory: overrides.priceHistory || [createPriceObservation({ amount: evidence.amount, currency: evidence.currency, observedAt: evidence.receivedAt })],
    billingHistory: overrides.billingHistory || [createBillingEvent({ amount: evidence.amount, currency: evidence.currency, billedAt: evidence.receivedAt })],
    recommendations: overrides.recommendations || [],
    category: overrides.category || normalized.category,
  })
}

export const detectPriceChange = (priceHistory = []) => {
  if (priceHistory.length < 2) return null
  const previousEntry = priceHistory[priceHistory.length - 2]
  const currentEntry = priceHistory[priceHistory.length - 1]
  // Never compare amounts across different - or unknown - currencies as a
  // price change: $10 USD -> $12 CAD is not a real increase, and currency
  // conversion is out of scope. Both observations must agree on a resolved
  // currency before amounts are meaningfully comparable.
  if (!previousEntry.currency || !currentEntry.currency || previousEntry.currency !== currentEntry.currency) return null
  const previous = previousEntry.amount
  const current = currentEntry.amount
  if (!previous || current <= previous) return null
  return { type: 'price_increase', previous, current, annualImpact: (current - previous) * 12, reason: 'The same subscription was observed at a higher price in a later receipt.' }
}

export const buildRecommendations = (record, relatedRecords = []) => {
  const recommendations = []
  const priceChange = detectPriceChange(record.priceHistory)
  if (priceChange) recommendations.push(createRecommendation({ type: 'price_increase', priority: 'medium', ...priceChange, evidenceIds: record.evidence.map(({ id }) => id) }))
  const overlap = relatedRecords.find((related) => {
    const pair = [record.canonicalService, related.canonicalService].sort().join('|')
    return related.id !== record.id && OVERLAP_PAIRS.has(pair)
  })
  if (overlap) recommendations.push(createRecommendation({ type: 'possible_overlap', priority: 'high', relatedSubscriptionId: overlap.id, reason: `Both ${record.canonicalService} and ${overlap.canonicalService} provide ${record.category.toLowerCase()} services.`, evidenceIds: [...record.evidence, ...overlap.evidence].map(({ id }) => id) }))
  return recommendations
}

export const mergeSubscriptionDetections = (records = []) => {
  const merged = new Map()
  records.forEach((record) => {
    const existing = merged.get(record.canonicalService)
    if (!existing) {
      merged.set(record.canonicalService, { ...record })
      return
    }
    existing.evidence = [...existing.evidence, ...record.evidence]
    // Each individual evidence/observation entry keeps its own original
    // currency - merging never overwrites or compares amounts across
    // currencies as equivalent. The subscription's headline currentPrice is
    // always paired with the currency of that same latest observation, so
    // the two never drift out of sync with each other.
    existing.priceHistory = [...existing.priceHistory, ...record.priceHistory].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)))
    existing.billingHistory = [...existing.billingHistory, ...record.billingHistory]
    const latestObservation = existing.priceHistory.at(-1)
    existing.currentPrice = latestObservation?.amount || existing.currentPrice
    existing.currency = latestObservation?.currency ?? existing.currency
    existing.confidence = existing.evidence.some((item) => item.confidence.state === 'confirmed') ? { score: 0.98, state: 'confirmed' } : existing.confidence
  })
  return [...merged.values()]
}
