import assert from 'node:assert/strict'
import test from 'node:test'
import { detectPriceChange } from '../src/services/priceChangeService.js'

const obs = (amount, currency, observedAt) => ({ amount, currency, observedAt })

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
