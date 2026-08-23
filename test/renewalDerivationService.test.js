import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveRenewal, RENEWAL_CERTAINTY, RENEWAL_TIMING, renewalCertaintyFor } from '../src/services/renewalDerivationService.js'

const NOW = new Date('2026-08-23T12:00:00Z')

test('renewalCertaintyFor resolves confirmed, inferred, unknown, corrected, and manual-entry states', () => {
  assert.equal(renewalCertaintyFor({ fieldObservations: [{ field: 'nextRenewal', provenance: 'confirmed' }] }, 'Gmail receipt'), RENEWAL_CERTAINTY.CONFIRMED)
  assert.equal(renewalCertaintyFor({ fieldObservations: [{ field: 'nextRenewal', provenance: 'inferred' }] }, 'Gmail receipt'), RENEWAL_CERTAINTY.INFERRED)
  assert.equal(renewalCertaintyFor({ fieldObservations: [] }, 'Gmail receipt'), RENEWAL_CERTAINTY.UNKNOWN)
  assert.equal(renewalCertaintyFor({ corrections: [{ field: 'next_renewal' }] }, 'Gmail receipt'), RENEWAL_CERTAINTY.CONFIRMED, 'FEATURE-002 corrections outrank a stale inferred/extracted value')
  assert.equal(renewalCertaintyFor({}, 'Manual entry'), RENEWAL_CERTAINTY.CONFIRMED, 'a manually-entered subscription\'s date is user-provided, i.e. confirmed')
})

test('deriveRenewal never fabricates a date for unknown certainty, even when nextRenewal happens to be set', () => {
  const result = deriveRenewal({ nextRenewal: '2026-08-30', certainty: RENEWAL_CERTAINTY.UNKNOWN, now: NOW })
  assert.deepEqual(result, { certainty: RENEWAL_CERTAINTY.UNKNOWN, date: null, timing: RENEWAL_TIMING.NONE, daysUntil: null })
})

test('deriveRenewal buckets timing per the approved 30/8/1/0-day windows', () => {
  assert.equal(deriveRenewal({ nextRenewal: '2026-10-01', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW }).timing, RENEWAL_TIMING.NONE, '>30 days out: no attention item')
  assert.equal(deriveRenewal({ nextRenewal: '2026-09-15', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW }).timing, RENEWAL_TIMING.UPCOMING, '8-30 days out')
  assert.equal(deriveRenewal({ nextRenewal: '2026-08-28', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW }).timing, RENEWAL_TIMING.SOON, '1-7 days out')
  assert.equal(deriveRenewal({ nextRenewal: '2026-08-23', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW }).timing, RENEWAL_TIMING.DUE_TODAY)
  assert.equal(deriveRenewal({ nextRenewal: '2026-08-01', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW }).timing, RENEWAL_TIMING.NONE, 'a date already in the past is never surfaced as upcoming')
})

test('deriveRenewal preserves confirmed vs inferred certainty distinctly - an inferred date is never presented as confirmed', () => {
  const confirmed = deriveRenewal({ nextRenewal: '2026-08-28', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW })
  const inferred = deriveRenewal({ nextRenewal: '2026-08-28', certainty: RENEWAL_CERTAINTY.INFERRED, now: NOW })
  assert.equal(confirmed.certainty, 'confirmed')
  assert.equal(inferred.certainty, 'inferred')
  assert.equal(confirmed.timing, inferred.timing, 'timing bucket depends only on the date, not on certainty')
})

test('deriveRenewal treats an unparseable date the same as no date at all', () => {
  assert.deepEqual(
    deriveRenewal({ nextRenewal: 'not a date', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW }),
    { certainty: RENEWAL_CERTAINTY.UNKNOWN, date: null, timing: RENEWAL_TIMING.NONE, daysUntil: null },
  )
})
