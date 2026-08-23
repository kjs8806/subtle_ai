import { fieldProvenanceFor } from './fieldProvenance.js'

// FEATURE-003's approved renewal look-ahead window (GitHub issue #22,
// Product Owner decision #2): more than 30 days out gets no attention item
// at all (Subscription Detail only, no card); the rest step down in urgency
// as the date approaches. Deliberately no "Urgent" label for an ordinary
// renewal - see the Product Owner's explicit instruction against alarmist
// labels.
export const RENEWAL_TIMING = { NONE: 'none', UPCOMING: 'upcoming', SOON: 'soon', DUE_TODAY: 'due_today' }
// certainty: 'confirmed' (explicit receipt/correction date), 'inferred'
// (derived from billing history/cadence, not an explicit future date), or
// 'unknown' (no reliable date at all - never fabricated).
export const RENEWAL_CERTAINTY = { CONFIRMED: 'confirmed', INFERRED: 'inferred', UNKNOWN: 'unknown' }

// Tech Lead remediation (GitHub PR #37, timezone hardening): normalizes to a
// UTC calendar day rather than local midnight. `date.setHours(0,0,0,0)`
// operates in the *runtime's local* timezone, but a date-only value (e.g.
// "2026-09-12", or a Postgres `date` column) is already anchored to UTC
// midnight by `new Date(...)` - recomputing "midnight" in local time can
// silently shift it onto the wrong calendar day depending on the server's
// timezone (and, near a DST transition, even the wrong day by a few hours
// either way). UTC has no DST and is the same everywhere, so anchoring both
// sides of the comparison to their UTC calendar day makes the day-count
// deterministic regardless of the runtime's TZ.
const toUtcMidnight = (dateValue) => {
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) return null
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

const daysUntil = (dateValue, now) => {
  const target = toUtcMidnight(dateValue)
  const today = toUtcMidnight(now)
  if (target === null || today === null) return null
  return Math.round((target - today) / 86400000)
}

const timingFor = (days) => {
  if (days === null || days > 30 || days < 0) return RENEWAL_TIMING.NONE
  if (days === 0) return RENEWAL_TIMING.DUE_TODAY
  if (days <= 7) return RENEWAL_TIMING.SOON
  return RENEWAL_TIMING.UPCOMING
}

// Resolves renewal certainty from the same field-observation/correction
// trail FEATURE-002's UI already reads (fieldProvenanceFor) - a correction
// or a "confirmed" field observation both count as confirmed; "inferred"
// stays inferred; anything else (no observation at all) is unknown. `record`
// is the raw backend subscription record; `source` is its display source
// label (e.g. "Gmail receipt").
export const renewalCertaintyFor = (record, source) => {
  const provenance = fieldProvenanceFor(record, 'nextRenewal', source)
  if (provenance === 'Confirmed by you' || provenance === 'User provided' || provenance.startsWith('Confirmed from')) return RENEWAL_CERTAINTY.CONFIRMED
  if (provenance.startsWith('Inferred from')) return RENEWAL_CERTAINTY.INFERRED
  return RENEWAL_CERTAINTY.UNKNOWN
}

// Pure renewal-state derivation. `now` is injectable for deterministic
// testing. Never fabricates a date: an unknown certainty or a missing/
// unparseable date always resolves to timing NONE with date null, regardless
// of what nextRenewal contains.
export const deriveRenewal = ({ nextRenewal, certainty, now = new Date() }) => {
  if (!nextRenewal || certainty === RENEWAL_CERTAINTY.UNKNOWN) return { certainty: RENEWAL_CERTAINTY.UNKNOWN, date: null, timing: RENEWAL_TIMING.NONE, daysUntil: null }
  const days = daysUntil(nextRenewal, now)
  if (days === null) return { certainty: RENEWAL_CERTAINTY.UNKNOWN, date: null, timing: RENEWAL_TIMING.NONE, daysUntil: null }
  return { certainty, date: nextRenewal, timing: timingFor(days), daysUntil: days }
}
