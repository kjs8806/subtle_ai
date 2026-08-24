import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
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

test('deriveRenewal never reports a renewal that already passed yesterday as upcoming', () => {
  const result = deriveRenewal({ nextRenewal: '2026-08-22', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: NOW })
  assert.equal(result.timing, RENEWAL_TIMING.NONE)
  assert.equal(result.daysUntil, -1)
})

// ---- Tech Lead remediation (GitHub PR #37, timezone hardening): day-count
// arithmetic must be UTC-safe, not local-midnight-safe - a date-only value is
// already anchored to UTC midnight by `new Date(...)`, so recomputing
// "midnight" via `.setHours(0,0,0,0)` (which operates in the runtime's local
// timezone) can silently shift it onto the wrong calendar day depending on
// server TZ, and around a DST transition even depending on the time of day.

test('deriveRenewal is unaffected by a `now` timestamp carrying a non-UTC offset - the UTC calendar day is what is compared, not the local one', () => {
  // 2026-08-29T23:30:00-07:00 is 2026-08-30T06:30:00Z - still August 30th in
  // UTC. A local-midnight implementation could read this as the 29th (in
  // some other local zone) or the 30th depending on the runtime's own TZ;
  // the UTC-anchored implementation is deterministic regardless.
  const lateLocalNow = new Date('2026-08-29T23:30:00-07:00')
  const result = deriveRenewal({ nextRenewal: '2026-09-05', certainty: RENEWAL_CERTAINTY.CONFIRMED, now: lateLocalNow })
  assert.equal(result.daysUntil, 6, 'Aug 30 (UTC) -> Sep 5 is 6 days, regardless of the -07:00 offset carried by `now`')
})

test('deriveRenewal day-count is identical whether the Node process runs under TZ=UTC or a DST-observing zone', () => {
  const script = `
    import { deriveRenewal, RENEWAL_CERTAINTY } from ${JSON.stringify(new URL('../src/services/renewalDerivationService.js', import.meta.url).href)}
    const cases = [
      ['2026-08-23T12:00:00Z', '2026-08-30'],  // 7 days out (SOON)
      ['2026-08-23T12:00:00Z', '2026-08-31'],  // 8 days out (UPCOMING)
      ['2026-08-23T12:00:00Z', '2026-09-22'],  // 30 days out (UPCOMING)
      ['2026-08-23T12:00:00Z', '2026-09-23'],  // 31 days out (NONE)
      // DST boundaries: US "spring forward" (2026-03-08) and "fall back" (2026-11-01).
      ['2026-03-01T12:00:00Z', '2026-03-08'],
      ['2026-03-05T12:00:00Z', '2026-03-13'],
      ['2026-10-25T12:00:00Z', '2026-11-01'],
      ['2026-10-28T12:00:00Z', '2026-11-05'],
    ]
    const results = cases.map(([now, nextRenewal]) => {
      const { timing, daysUntil } = deriveRenewal({ nextRenewal, certainty: RENEWAL_CERTAINTY.CONFIRMED, now: new Date(now) })
      return [timing, daysUntil]
    })
    process.stdout.write(JSON.stringify(results))
  `
  const runUnder = (tz) => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }))
  const utc = runUnder('UTC')
  const nonUtc = runUnder('America/New_York')
  assert.deepEqual(nonUtc, utc, 'the same (now, nextRenewal) pairs must produce identical timing/daysUntil under any runtime TZ, including across DST boundaries')
  // Sanity-check the UTC run actually exercised every threshold, not all NONE/0.
  assert.deepEqual(utc, [['soon', 7], ['upcoming', 8], ['upcoming', 30], ['none', 31], ['soon', 7], ['upcoming', 8], ['soon', 7], ['upcoming', 8]])
})
