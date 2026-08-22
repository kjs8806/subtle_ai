import assert from 'node:assert/strict'
import test from 'node:test'
import { RenewalDerivationService } from '../src/services/renewalDerivationService.js'

// FEATURE-003 Definition of Done: confirmed (from evidence)/confirmed (from a
// FEATURE-002 correction)/inferred/unknown renewal certainty, all four bucket
// boundaries, and a malformed next_renewal string degrading safely rather
// than throwing.
const NOW = new Date(Date.UTC(2026, 0, 1)) // 2026-01-01T00:00:00Z
const dateAt = (isoDate) => new Date(`${isoDate}T00:00:00Z`)

test('confirmed certainty from evidence: a non-null next_renewal backed by confirmed-provenance field_observations', () => {
  const subscription = {
    nextRenewal: '2026-01-08',
    billingCycle: null,
    corrections: [],
    fieldObservations: [{ field: 'nextRenewal', value: '2026-01-08', provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }],
    billingHistory: [],
  }
  const derived = RenewalDerivationService.derive({ subscription, now: NOW })
  assert.equal(derived.certainty, 'confirmed')
  assert.equal(derived.renewalDate, '2026-01-08')
  assert.equal(derived.daysUntil, 7)
  assert.equal(derived.bucket, 'soon')
})

test('confirmed certainty from a FEATURE-002 correction (reuses the user_confirmed concept) even with no matching field_observations at all', () => {
  const subscription = {
    nextRenewal: '2026-01-08',
    billingCycle: null,
    corrections: [{ id: 'corr-1', field: 'next_renewal', value: '2026-01-08', createdAt: '2026-01-01T00:00:00.000Z' }],
    fieldObservations: [],
    billingHistory: [],
  }
  const derived = RenewalDerivationService.derive({ subscription, now: NOW })
  assert.equal(derived.certainty, 'confirmed')
  assert.equal(derived.bucket, 'soon')
})

test('a next_renewal text with only inferred-provenance backing is not confirmed, and with no other signal is unknown', () => {
  const subscription = {
    nextRenewal: '2026-01-08',
    billingCycle: null,
    corrections: [],
    fieldObservations: [{ field: 'nextRenewal', value: '2026-01-08', provenance: 'inferred', confidence: 0.4, evidenceId: 'ev-1' }],
    billingHistory: [],
  }
  const derived = RenewalDerivationService.derive({ subscription, now: NOW })
  assert.equal(derived.certainty, 'unknown', 'a weak/unconfirmed prediction must not surface as confirmed or inferred')
  assert.equal(derived.bucket, null)
})

test('inferred certainty: known cadence + most recent real billing event, projected forward', () => {
  const subscription = { nextRenewal: null, billingCycle: 'monthly', corrections: [], fieldObservations: [], billingHistory: [{ billedAt: '2025-12-01T00:00:00.000Z' }] }
  const derived = RenewalDerivationService.derive({ subscription, billingHistory: subscription.billingHistory, now: NOW })
  assert.equal(derived.certainty, 'inferred')
  assert.equal(derived.renewalDate, '2026-01-01')
  assert.equal(derived.daysUntil, 0)
  assert.equal(derived.bucket, 'due_today')
})

test('inferred certainty repeats forward past `now` when evidence is stale by more than one cycle', () => {
  const subscription = { nextRenewal: null, billingCycle: 'monthly', corrections: [], fieldObservations: [], billingHistory: [{ billedAt: '2025-01-01T00:00:00.000Z' }] }
  const derived = RenewalDerivationService.derive({ subscription, billingHistory: subscription.billingHistory, now: NOW })
  assert.equal(derived.certainty, 'inferred')
  assert.equal(derived.renewalDate, '2026-01-01', 'projects forward past every elapsed monthly cycle, not just one')
  assert.equal(derived.daysUntil, 0)
})

test('inferred certainty works for yearly cadence too', () => {
  const subscription = { nextRenewal: null, billingCycle: 'yearly', corrections: [], fieldObservations: [], billingHistory: [{ billedAt: '2025-01-01T00:00:00.000Z' }] }
  const derived = RenewalDerivationService.derive({ subscription, billingHistory: subscription.billingHistory, now: NOW })
  assert.equal(derived.certainty, 'inferred')
  assert.equal(derived.renewalDate, '2026-01-01')
})

test('unknown certainty: no cadence at all, even with billing history present', () => {
  const subscription = { nextRenewal: null, billingCycle: null, corrections: [], fieldObservations: [], billingHistory: [{ billedAt: '2025-12-01T00:00:00.000Z' }] }
  const derived = RenewalDerivationService.derive({ subscription, billingHistory: subscription.billingHistory, now: NOW })
  assert.equal(derived.certainty, 'unknown')
  assert.equal(derived.renewalDate, null)
  assert.equal(derived.bucket, null)
})

test('unknown certainty: known cadence but no billing history at all', () => {
  const subscription = { nextRenewal: null, billingCycle: 'monthly', corrections: [], fieldObservations: [], billingHistory: [] }
  const derived = RenewalDerivationService.derive({ subscription, billingHistory: [], now: NOW })
  assert.equal(derived.certainty, 'unknown')
})

test('a malformed/unparseable next_renewal string degrades safely to inference rather than throwing', () => {
  const subscription = {
    nextRenewal: 'coming up soon', // no explicit year - never guessed at
    billingCycle: 'monthly',
    corrections: [],
    fieldObservations: [{ field: 'nextRenewal', value: 'coming up soon', provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }],
    billingHistory: [{ billedAt: '2025-12-01T00:00:00.000Z' }],
  }
  assert.doesNotThrow(() => RenewalDerivationService.derive({ subscription, billingHistory: subscription.billingHistory, now: NOW }))
  const derived = RenewalDerivationService.derive({ subscription, billingHistory: subscription.billingHistory, now: NOW })
  assert.equal(derived.certainty, 'inferred', 'falls through to billing-history inference, not thrown, not fabricated as confirmed')
  assert.equal(derived.renewalDate, '2026-01-01')
})

test('a malformed next_renewal string with no fallback signal degrades to unknown, never throws', () => {
  const subscription = {
    nextRenewal: 'coming up soon',
    billingCycle: null,
    corrections: [],
    fieldObservations: [{ field: 'nextRenewal', value: 'coming up soon', provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }],
    billingHistory: [],
  }
  assert.doesNotThrow(() => RenewalDerivationService.derive({ subscription, now: NOW }))
  assert.equal(RenewalDerivationService.derive({ subscription, now: NOW }).certainty, 'unknown')
})

// QA defect fix: a confirmed date that has already passed must never surface
// as `due_today` (or as `confirmed` at all) forever - the Product Owner's
// table only defines 0 -> due_today, never negative.
const staleConfirmedSubscription = (daysAgo, extra = {}) => {
  const isoDate = new Date(NOW.getTime() - daysAgo * 86400000).toISOString().slice(0, 10)
  return {
    nextRenewal: isoDate,
    billingCycle: null,
    corrections: [],
    fieldObservations: [{ field: 'nextRenewal', value: isoDate, provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }],
    billingHistory: [],
    ...extra,
  }
}

test('a confirmed renewal date 1 day in the past does not return due_today', () => {
  const derived = RenewalDerivationService.derive({ subscription: staleConfirmedSubscription(1), now: NOW })
  assert.notEqual(derived.bucket, 'due_today')
  assert.notEqual(derived.certainty, 'confirmed')
})

test('a substantially stale confirmed renewal (60 days in the past) also falls through, never surfaces as due_today', () => {
  const derived = RenewalDerivationService.derive({ subscription: staleConfirmedSubscription(60), now: NOW })
  assert.notEqual(derived.bucket, 'due_today')
  assert.notEqual(derived.certainty, 'confirmed')
})

test('a stale confirmed renewal falls through to inference when cadence + billing history support it, using the freshly-inferred date instead', () => {
  const subscription = staleConfirmedSubscription(10, { billingCycle: 'monthly', billingHistory: [{ billedAt: '2025-12-01T00:00:00.000Z' }] })
  const derived = RenewalDerivationService.derive({ subscription, billingHistory: subscription.billingHistory, now: NOW })
  assert.equal(derived.certainty, 'inferred', 'never reports the stale date as confirmed')
  assert.equal(derived.renewalDate, '2026-01-01', 'uses the freshly-inferred date, not the stale confirmed one')
  assert.equal(derived.bucket, 'due_today')
})

test('a stale confirmed renewal with no valid fallback (no cadence, no billing history) degrades to unknown', () => {
  const derived = RenewalDerivationService.derive({ subscription: staleConfirmedSubscription(10), now: NOW })
  assert.equal(derived.certainty, 'unknown')
  assert.equal(derived.renewalDate, null)
  assert.equal(derived.bucket, null)
})

// QA defect fix: Date.UTC silently normalizes an impossible calendar date
// instead of rejecting it - each of these must be treated as unparseable
// (never a normalized-but-wrong confirmed date), falling through to unknown
// since there is no cadence/billing-history fallback in any of these cases.
test('an invalid date (Feb 30) is rejected as unparseable, never silently normalized to March', () => {
  const subscription = { nextRenewal: '2026-02-30', billingCycle: null, corrections: [], fieldObservations: [{ field: 'nextRenewal', value: '2026-02-30', provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }], billingHistory: [] }
  assert.doesNotThrow(() => RenewalDerivationService.derive({ subscription, now: NOW }))
  const derived = RenewalDerivationService.derive({ subscription, now: NOW })
  assert.equal(derived.certainty, 'unknown')
  assert.notEqual(derived.renewalDate, '2026-03-02', 'never the JS-normalized rollover date')
})

test('an invalid month (13) is rejected as unparseable, never silently normalized into the next year', () => {
  const subscription = { nextRenewal: '2026-13-01', billingCycle: null, corrections: [], fieldObservations: [{ field: 'nextRenewal', value: '2026-13-01', provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }], billingHistory: [] }
  const derived = RenewalDerivationService.derive({ subscription, now: NOW })
  assert.equal(derived.certainty, 'unknown')
  assert.notEqual(derived.renewalDate, '2027-01-01')
})

test('an invalid day-of-month (April 31) is rejected as unparseable, never silently normalized to May', () => {
  const subscription = { nextRenewal: '2026-04-31', billingCycle: null, corrections: [], fieldObservations: [{ field: 'nextRenewal', value: '2026-04-31', provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }], billingHistory: [] }
  const derived = RenewalDerivationService.derive({ subscription, now: NOW })
  assert.equal(derived.certainty, 'unknown')
  assert.notEqual(derived.renewalDate, '2026-05-01')
})

// Product's fixed look-ahead table, exercised at every stated boundary.
const bucketCase = (daysOut) => {
  const target = new Date(NOW.getTime() + daysOut * 86400000)
  const isoDate = target.toISOString().slice(0, 10)
  return {
    nextRenewal: isoDate,
    billingCycle: null,
    corrections: [],
    fieldObservations: [{ field: 'nextRenewal', value: isoDate, provenance: 'confirmed', confidence: 0.9, evidenceId: 'ev-1' }],
    billingHistory: [],
  }
}

test('bucket boundary: 31 days out is more than 30 days away - no attention item (bucket null)', () => {
  assert.equal(RenewalDerivationService.derive({ subscription: bucketCase(31), now: NOW }).bucket, null)
})
test('bucket boundary: 30 days out is upcoming', () => {
  assert.equal(RenewalDerivationService.derive({ subscription: bucketCase(30), now: NOW }).bucket, 'upcoming')
})
test('bucket boundary: 8 days out is upcoming', () => {
  assert.equal(RenewalDerivationService.derive({ subscription: bucketCase(8), now: NOW }).bucket, 'upcoming')
})
test('bucket boundary: 7 days out is soon', () => {
  assert.equal(RenewalDerivationService.derive({ subscription: bucketCase(7), now: NOW }).bucket, 'soon')
})
test('bucket boundary: 1 day out is soon', () => {
  assert.equal(RenewalDerivationService.derive({ subscription: bucketCase(1), now: NOW }).bucket, 'soon')
})
test('bucket boundary: 0 days out (today) is due_today', () => {
  assert.equal(RenewalDerivationService.derive({ subscription: bucketCase(0), now: NOW }).bucket, 'due_today')
})

test('sanity: dateAt helper matches the confirmed-path parsed date', () => {
  assert.equal(dateAt('2026-01-08').toISOString().slice(0, 10), '2026-01-08')
})
