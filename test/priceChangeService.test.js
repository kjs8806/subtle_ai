import assert from 'node:assert/strict'
import test from 'node:test'
import { AnnualImpactCalculator } from '../src/services/annualImpactCalculator.js'
import { PriceChangeService } from '../src/services/priceChangeService.js'

// FEATURE-003 Definition of Done: unit tests for increase/decrease/no-change,
// same/unknown/mismatched currency, monthly/yearly/unknown cadence, and
// deterministic (integer-cents, no float drift) annualization/materiality
// boundaries. Every assertion here is on a concrete number, never "truthy".

test('AnnualImpactCalculator: x12 for monthly, x1 for yearly, null for unknown cadence, in integer cents', () => {
  assert.equal(AnnualImpactCalculator.annualizeCents(200, 'monthly'), 2400)
  assert.equal(AnnualImpactCalculator.annualizeCents(2400, 'yearly'), 2400)
  assert.equal(AnnualImpactCalculator.annualizeCents(200, null), null)
  assert.equal(AnnualImpactCalculator.annualizeCents(200, 'weekly'), null)
  assert.equal(AnnualImpactCalculator.annualizeCents(200, undefined), null)
  assert.equal(AnnualImpactCalculator.annualizeCents(NaN, 'monthly'), null)
  assert.equal(AnnualImpactCalculator.annualizeCents('200', 'monthly'), null, 'never coerces a non-number')
})

test('detects a price increase and computes exact integer-cents figures', () => {
  const event = PriceChangeService.detect({
    previousObservation: { amount: 19.99, currency: 'USD' },
    currentObservation: { amount: 22.99, currency: 'USD' },
    cadence: 'monthly',
  })
  assert.ok(event)
  assert.equal(event.direction, 'increase')
  assert.equal(event.previousPriceCents, 1999)
  assert.equal(event.currentPriceCents, 2299)
  assert.equal(event.percentChangeBp, Math.round((300 * 10000) / 1999))
  assert.equal(event.annualizedDeltaCents, 3600)
  assert.equal(event.currency, 'USD')
  assert.equal(event.ruleVersion, 'v1')
})

test('detects a price decrease, never marks it material regardless of magnitude', () => {
  const event = PriceChangeService.detect({
    previousObservation: { amount: 20, currency: 'USD' },
    currentObservation: { amount: 10, currency: 'USD' },
    cadence: 'monthly',
  })
  assert.ok(event)
  assert.equal(event.direction, 'decrease')
  assert.equal(event.previousPriceCents, 2000)
  assert.equal(event.currentPriceCents, 1000)
  assert.equal(event.percentChangeBp, -5000, '50% decrease is -5000bp')
  assert.equal(event.annualizedDeltaCents, -12000)
  assert.equal(event.isMaterial, false, 'a decrease is never material, however large')
})

test('no change at all produces no event, not even a zero-magnitude decrease', () => {
  assert.equal(PriceChangeService.detect({ previousObservation: { amount: 10, currency: 'USD' }, currentObservation: { amount: 10, currency: 'USD' }, cadence: 'monthly' }), null)
})

test('a first-ever observation (no previous) has nothing to compare: no event', () => {
  assert.equal(PriceChangeService.detect({ previousObservation: null, currentObservation: { amount: 10, currency: 'USD' }, cadence: 'monthly' }), null)
  assert.equal(PriceChangeService.detect({ currentObservation: { amount: 10, currency: 'USD' } }), null)
})

test('never compares amounts across different or unknown currencies', () => {
  assert.equal(PriceChangeService.detect({ previousObservation: { amount: 10, currency: 'USD' }, currentObservation: { amount: 12, currency: 'CAD' } }), null, 'mismatched currencies')
  assert.equal(PriceChangeService.detect({ previousObservation: { amount: 10, currency: null }, currentObservation: { amount: 12, currency: null } }), null, 'both unknown')
  assert.equal(PriceChangeService.detect({ previousObservation: { amount: 10, currency: 'USD' }, currentObservation: { amount: 12, currency: null } }), null, 'one unknown')
  assert.equal(PriceChangeService.detect({ previousObservation: { amount: 10 }, currentObservation: { amount: 12 } }), null, 'currency field absent entirely')
})

test('cadence: annualized delta present for monthly, present for yearly, absent (null) for unknown cadence', () => {
  const monthly = PriceChangeService.detect({ previousObservation: { amount: 10, currency: 'USD' }, currentObservation: { amount: 11, currency: 'USD' }, cadence: 'monthly' })
  assert.equal(monthly.annualizedDeltaCents, 1200)
  const yearly = PriceChangeService.detect({ previousObservation: { amount: 100, currency: 'USD' }, currentObservation: { amount: 110, currency: 'USD' }, cadence: 'yearly' })
  assert.equal(yearly.annualizedDeltaCents, 1000)
  const unknown = PriceChangeService.detect({ previousObservation: { amount: 10, currency: 'USD' }, currentObservation: { amount: 10.20, currency: 'USD' }, cadence: null })
  assert.equal(unknown.annualizedDeltaCents, null)
  assert.equal(unknown.percentChangeBp, 200, '2% increase, well under the 5% threshold')
  assert.equal(unknown.isMaterial, false, 'no cadence and under 5% is not material')
})

test('materiality boundary: exactly 5% increase is material, just under is not (with no annualized figure to fall back on)', () => {
  // previous $20.00 -> current $21.00 is exactly a 5% increase (2000 -> 2100 cents).
  const atThreshold = PriceChangeService.detect({ previousObservation: { amount: 20, currency: 'USD' }, currentObservation: { amount: 21, currency: 'USD' }, cadence: null })
  assert.equal(atThreshold.percentChangeBp, 500)
  assert.equal(atThreshold.isMaterial, true)

  // previous $20.00 -> current $20.99 is 4.95%, just under 5%.
  const justUnder = PriceChangeService.detect({ previousObservation: { amount: 20, currency: 'USD' }, currentObservation: { amount: 20.99, currency: 'USD' }, cadence: null })
  assert.equal(justUnder.percentChangeBp, 495)
  assert.equal(justUnder.isMaterial, false)
})

test('materiality boundary: exactly $24/year annualized is material even when percent is small (monthly cadence)', () => {
  // previous $100.00/month -> current $102.00/month: 2% increase, but $2/month x 12 = $24/year exactly.
  const atThreshold = PriceChangeService.detect({ previousObservation: { amount: 100, currency: 'USD' }, currentObservation: { amount: 102, currency: 'USD' }, cadence: 'monthly' })
  assert.equal(atThreshold.percentChangeBp, 200, 'only 2% - would not be material via percent alone')
  assert.equal(atThreshold.annualizedDeltaCents, 2400)
  assert.equal(atThreshold.isMaterial, true)

  // previous $100.00/month -> current $101.99/month: $1.99/month x 12 = $23.88/year, just under $24.
  const justUnder = PriceChangeService.detect({ previousObservation: { amount: 100, currency: 'USD' }, currentObservation: { amount: 101.99, currency: 'USD' }, cadence: 'monthly' })
  assert.equal(justUnder.annualizedDeltaCents, 2388)
  assert.equal(justUnder.percentChangeBp, 199)
  assert.equal(justUnder.isMaterial, false)
})

test('materiality boundary: exactly $24/year annualized is material for yearly cadence too (CAD, own-currency threshold)', () => {
  // previous CAD $1000.00/year -> current CAD $1024.00/year: 2.4% increase, $24/year exactly.
  const atThreshold = PriceChangeService.detect({ previousObservation: { amount: 1000, currency: 'CAD' }, currentObservation: { amount: 1024, currency: 'CAD' }, cadence: 'yearly' })
  assert.equal(atThreshold.currency, 'CAD')
  assert.equal(atThreshold.annualizedDeltaCents, 2400)
  assert.equal(atThreshold.percentChangeBp, 240)
  assert.equal(atThreshold.isMaterial, true)

  const justUnder = PriceChangeService.detect({ previousObservation: { amount: 1000, currency: 'CAD' }, currentObservation: { amount: 1023.99, currency: 'CAD' }, cadence: 'yearly' })
  assert.equal(justUnder.annualizedDeltaCents, 2399)
  assert.equal(justUnder.isMaterial, false)
})

test('integer-cents math produces exact expected values with no float drift across many fractional-cent-prone inputs', () => {
  const cases = [
    { previous: 9.99, current: 10.49, cadence: 'monthly', expectedPercentBp: Math.round((50 * 10000) / 999), expectedAnnualized: 600 },
    { previous: 0.1, current: 0.2, cadence: null, expectedPercentBp: 10000, expectedAnnualized: null },
    { previous: 29.97, current: 32.97, cadence: 'yearly', expectedPercentBp: Math.round((300 * 10000) / 2997), expectedAnnualized: 300 },
  ]
  for (const testCase of cases) {
    const event = PriceChangeService.detect({ previousObservation: { amount: testCase.previous, currency: 'USD' }, currentObservation: { amount: testCase.current, currency: 'USD' }, cadence: testCase.cadence })
    assert.equal(event.percentChangeBp, testCase.expectedPercentBp, `percentChangeBp for ${testCase.previous} -> ${testCase.current}`)
    assert.equal(event.annualizedDeltaCents, testCase.expectedAnnualized, `annualizedDeltaCents for ${testCase.previous} -> ${testCase.current}`)
    assert.equal(Number.isInteger(event.percentChangeBp), true)
    if (event.annualizedDeltaCents !== null) assert.equal(Number.isInteger(event.annualizedDeltaCents), true)
  }
})
