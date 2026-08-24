import assert from 'node:assert/strict'
import test from 'node:test'
import { annualizedAmount, annualizedImpact, percentChange, periodDelta } from '../src/services/annualImpactCalculator.js'

test('periodDelta avoids binary-float subtraction error', () => {
  assert.equal(periodDelta(15.49, 17.99), 2.5, 'raw 17.99 - 15.49 is 2.4999999999999982 in binary floating point')
  assert.equal(periodDelta(22.99, 19.99), -3)
  assert.equal(periodDelta(null, 10), null)
})

test('annualizedAmount annualizes by cadence and rejects unknown cadences without guessing', () => {
  assert.equal(annualizedAmount(9.99, 'monthly'), 119.88)
  assert.equal(annualizedAmount(119.99, 'yearly'), 119.99)
  assert.equal(annualizedAmount(9.99, 'weekly'), null)
  assert.equal(annualizedAmount(9.99, null), null)
  assert.equal(annualizedAmount(null, 'monthly'), null)
})

test('annualizedImpact computes the cadence-aware annual delta, never using binary-float-lossy arithmetic', () => {
  assert.equal(annualizedImpact(15.49, 17.99, 'monthly'), 30)
  assert.equal(annualizedImpact(109.99, 119.99, 'yearly'), 10)
  assert.equal(annualizedImpact(22.99, 19.99, 'monthly'), -36)
  // A classic float-drift trap: 0.1 + 0.2 !== 0.3 in binary floating point,
  // and 4.35 * 100 rounds to 434.99999... rather than 435 without care.
  // annualizedAmount/annualizedImpact route every step through integer
  // minor units specifically to avoid this.
  assert.equal(annualizedImpact(4.3, 4.35, 'monthly'), 0.6)
  assert.equal(annualizedImpact(null, 10, 'monthly'), null)
  assert.equal(annualizedImpact(10, 12, 'unknown'), null)
})

test('percentChange is deterministic and refuses to divide by (or compare against) a non-numeric/zero previous amount', () => {
  assert.equal(Math.round(percentChange(15.49, 17.99) * 100) / 100, 16.14)
  assert.equal(percentChange(20, 19), -5)
  assert.equal(percentChange(0, 10), null)
  assert.equal(percentChange(null, 10), null)
  assert.equal(percentChange(10, null), null)
})
