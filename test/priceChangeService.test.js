import assert from 'node:assert/strict'
import test from 'node:test'
import { detectPriceChange, detectPriceChangeEvents } from '../src/services/priceChangeService.js'

const obs = (amount, currency, observedAt) => ({ amount, currency, observedAt })
const obsId = (id, amount, currency, observedAt) => ({ id, amount, currency, observedAt })

test('detectPriceChange identifies a material increase and flags it attention-worthy', () => {
  const result = detectPriceChange({
    currentPrice: 17.99, currency: 'USD', cadence: 'monthly',
    priceHistory: [obs(15.49, 'USD', '2026-06-12'), obs(17.99, 'USD', '2026-08-12')],
  })
  assert.equal(result.changeType, 'increase')
  assert.equal(result.previousPrice, 15.49)
  assert.equal(result.currentPrice, 17.99)
  assert.equal(result.perPeriodDelta, 2.5)
  assert.equal(result.annualImpact, 30)
  assert.equal(result.firstSeenAt, '2026-08-12')
  assert.equal(result.isAttentionWorthy, true, '2.5/mo is both >=5% and >=$24/year')
})

test('detectPriceChange records a decrease as a fact but never marks it attention-worthy', () => {
  const result = detectPriceChange({
    currentPrice: 9.99, currency: 'USD', cadence: 'monthly',
    priceHistory: [obs(12.99, 'USD', '2026-01-01'), obs(9.99, 'USD', '2026-08-01')],
  })
  assert.equal(result.changeType, 'decrease')
  assert.equal(result.isAttentionWorthy, false)
})

test('detectPriceChange returns null for no-change (identical amounts never register as a change)', () => {
  const result = detectPriceChange({
    currentPrice: 9.99, currency: 'USD', cadence: 'monthly',
    priceHistory: [obs(9.99, 'USD', '2026-01-01'), obs(9.99, 'USD', '2026-08-01')],
  })
  assert.equal(result, null)
})

test('detectPriceChange refuses to compare across an unknown or mismatched currency rather than guessing', () => {
  assert.equal(detectPriceChange({ currentPrice: 17.99, currency: null, cadence: 'monthly', priceHistory: [obs(15.49, 'USD', '2026-01-01')] }), null, 'unknown current currency')
  assert.equal(
    detectPriceChange({ currentPrice: 17.99, currency: 'USD', cadence: 'monthly', priceHistory: [obs(15.49, 'CAD', '2026-01-01')] }),
    null,
    'previous observation in a different currency must never be treated as comparable',
  )
  assert.equal(
    detectPriceChange({ currentPrice: 17.99, currency: 'USD', cadence: 'monthly', priceHistory: [obs(15.49, null, '2026-01-01')] }),
    null,
    'previous observation with unknown currency must never be treated as comparable',
  )
})

test('detectPriceChange requires a recognized cadence and enough history, never fabricating a comparison', () => {
  assert.equal(detectPriceChange({ currentPrice: 17.99, currency: 'USD', cadence: null, priceHistory: [obs(15.49, 'USD', '2026-01-01')] }), null, 'unknown cadence')
  assert.equal(detectPriceChange({ currentPrice: 17.99, currency: 'USD', cadence: 'monthly', priceHistory: [] }), null, 'no history at all')
  assert.equal(detectPriceChange({ currentPrice: 17.99, currency: 'USD', cadence: 'monthly', priceHistory: [obs(17.99, 'USD', '2026-01-01')] }), null, 'only one distinct price ever observed')
})

test('detectPriceChange annualizes by the subscription\'s real cadence, not a hardcoded monthly assumption', () => {
  const yearly = detectPriceChange({
    currentPrice: 119.99, currency: 'USD', cadence: 'yearly',
    priceHistory: [obs(109.99, 'USD', '2025-08-23'), obs(119.99, 'USD', '2026-08-23')],
  })
  assert.equal(yearly.annualImpact, 10, 'a $10/year increase on a yearly plan is $10/year impact, not $120')
})

test('detectPriceChange treats a >=5% increase under $24/year as attention-worthy on the percentage leg alone', () => {
  // $1.00/month increase on a $10/month plan: 10% but only $12/year.
  const result = detectPriceChange({
    currentPrice: 11, currency: 'USD', cadence: 'monthly',
    priceHistory: [obs(10, 'USD', '2026-01-01'), obs(11, 'USD', '2026-08-01')],
  })
  assert.equal(result.isAttentionWorthy, true)
})

test('detectPriceChange treats a >=$24/year increase under 5% as attention-worthy on the annual-impact leg alone', () => {
  // $3/month increase on a $100/month plan: $36/year but only 3%.
  const result = detectPriceChange({
    currentPrice: 103, currency: 'USD', cadence: 'monthly',
    priceHistory: [obs(100, 'USD', '2026-01-01'), obs(103, 'USD', '2026-08-01')],
  })
  assert.equal(result.isAttentionWorthy, true)
})

test('detectPriceChange does not flag a small increase under both thresholds', () => {
  // $0.50/month increase on a $100/month plan: 0.5% and only $6/year.
  const result = detectPriceChange({
    currentPrice: 100.5, currency: 'USD', cadence: 'monthly',
    priceHistory: [obs(100, 'USD', '2026-01-01'), obs(100.5, 'USD', '2026-08-01')],
  })
  assert.equal(result.isAttentionWorthy, false)
})

test('detectPriceChange honors a FEATURE-002 correction as the current price even with no matching observation', () => {
  // The subscription's current_price was corrected to 18.50 by the user;
  // price_observations only ever has the original receipt-derived amount.
  const result = detectPriceChange({
    currentPrice: 18.5, currency: 'USD', cadence: 'monthly',
    priceHistory: [obs(15.49, 'USD', '2026-06-12')],
  })
  assert.equal(result.previousPrice, 15.49)
  assert.equal(result.currentPrice, 18.5)
  assert.equal(result.firstSeenAt, null, 'no receipt observation matches the corrected price, so there is no observed "first seen" date')
})

// ---- detectPriceChangeEvents: Tech Lead remediation (GitHub PR #37,
// BLOCKER 2) - a durable, per-occurrence event log, not just "the latest
// transition."

test('detectPriceChangeEvents: separate transitions through the same two prices at different times are distinct events with distinct observation-pair identities', () => {
  const history = [
    obsId('obs-jan-10', 10, 'USD', '2026-01-01'),
    obsId('obs-jan-12', 12, 'USD', '2026-01-15'), // event A: 10 -> 12
    obsId('obs-jun-10', 10, 'USD', '2026-06-01'), // event B: 12 -> 10
    obsId('obs-dec-12', 12, 'USD', '2026-12-01'), // event C: 10 -> 12 again
  ]
  const events = detectPriceChangeEvents({ currency: 'USD', cadence: 'monthly', priceHistory: history })
  assert.equal(events.length, 3)

  const [eventA, eventB, eventC] = events
  assert.equal(eventA.previousPrice, 10); assert.equal(eventA.currentPrice, 12); assert.equal(eventA.changeType, 'increase')
  assert.equal(eventB.previousPrice, 12); assert.equal(eventB.currentPrice, 10); assert.equal(eventB.changeType, 'decrease')
  assert.equal(eventC.previousPrice, 10); assert.equal(eventC.currentPrice, 12); assert.equal(eventC.changeType, 'increase')

  // Event A and event C are the same price transition (10 -> 12) at
  // different points in time - their observation-pair identity must differ,
  // proving raw price values alone are never used as identity.
  const keyFor = (event) => `${event.previousObservation.id}:${event.currentObservation.id}`
  assert.notEqual(keyFor(eventA), keyFor(eventC), 'January\'s 10->12 and December\'s 10->12 must not collide')
  assert.equal(eventA.previousObservation.id, 'obs-jan-10')
  assert.equal(eventA.currentObservation.id, 'obs-jan-12')
  assert.equal(eventC.previousObservation.id, 'obs-jun-10')
  assert.equal(eventC.currentObservation.id, 'obs-dec-12')
})

test('detectPriceChangeEvents collapses a run of repeated identical-price observations into a single transition, not one per observation', () => {
  const history = [
    obsId('a', 10, 'USD', '2026-01-01'),
    obsId('b', 10, 'USD', '2026-02-01'),
    obsId('c', 12, 'USD', '2026-03-01'),
    obsId('d', 12, 'USD', '2026-04-01'),
    obsId('e', 12, 'USD', '2026-05-01'),
  ]
  const events = detectPriceChangeEvents({ currency: 'USD', cadence: 'monthly', priceHistory: history })
  assert.equal(events.length, 1)
  // Previous is the *last* observation of the prior run; current is the
  // *first* observation of the new run - matching detectPriceChange's
  // existing "first seen" semantics, just applied at every transition.
  assert.equal(events[0].previousObservation.id, 'b')
  assert.equal(events[0].currentObservation.id, 'c')
})

test('detectPriceChangeEvents is idempotent on rescan: recomputing from the identical history yields the identical set of identities', () => {
  const history = [obsId('a', 10, 'USD', '2026-01-01'), obsId('b', 12, 'USD', '2026-02-01')]
  const first = detectPriceChangeEvents({ currency: 'USD', cadence: 'monthly', priceHistory: history })
  const second = detectPriceChangeEvents({ currency: 'USD', cadence: 'monthly', priceHistory: history })
  const keyFor = (event) => `${event.previousObservation.id}:${event.currentObservation.id}`
  assert.deepEqual(first.map(keyFor), second.map(keyFor))
})

test('detectPriceChangeEvents ignores observations in a different or unknown currency and never fabricates from an unknown cadence', () => {
  assert.deepEqual(detectPriceChangeEvents({ currency: 'USD', cadence: 'monthly', priceHistory: [obsId('a', 10, 'CAD', '2026-01-01'), obsId('b', 12, 'USD', '2026-02-01')] }), [], 'only one USD observation exists - nothing to compare')
  assert.deepEqual(detectPriceChangeEvents({ currency: 'USD', cadence: null, priceHistory: [obsId('a', 10, 'USD', '2026-01-01'), obsId('b', 12, 'USD', '2026-02-01')] }), [], 'unknown cadence')
  assert.deepEqual(detectPriceChangeEvents({ currency: null, cadence: 'monthly', priceHistory: [obsId('a', 10, 'USD', '2026-01-01')] }), [], 'unknown currency')
  assert.deepEqual(detectPriceChangeEvents({ currency: 'USD', cadence: 'monthly', priceHistory: [] }), [], 'no history at all')
})
