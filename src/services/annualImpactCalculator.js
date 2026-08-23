// FEATURE-003: deterministic, currency-agnostic annualized-impact math.
// Money enters and leaves as JS numbers (dollars) - matching the rest of the
// codebase's convention (price_observations.amount is Postgres NUMERIC(12,2),
// parsed to a float at the DB boundary, see postgresRepository.js) - but
// every intermediate step here happens in integer minor units (cents) so
// repeated multiplication/subtraction can't accumulate binary
// floating-point drift. Tech Lead guidance (GitHub issue #22) calls this out
// specifically for price-change/annualized-impact math: unlike a stored,
// already-rounded price, these are multi-step derived values where drift
// could flip a threshold comparison (e.g. the $24/year materiality gate).
const toMinorUnits = (amount) => Math.round(amount * 100)
const fromMinorUnits = (minorUnits) => minorUnits / 100

// Only the two cadences FEATURE-001/002 support - an unrecognized/missing
// cadence returns null (no derived claim) rather than guessing a period count.
const PERIODS_PER_YEAR = { monthly: 12, yearly: 1 }

// Annualizes a single per-period amount for a known cadence.
export const annualizedAmount = (amount, cadence) => {
  const periods = PERIODS_PER_YEAR[cadence]
  if (typeof amount !== 'number' || !Number.isFinite(amount) || !periods) return null
  return fromMinorUnits(toMinorUnits(amount) * periods)
}

// A plain per-period delta (currentAmount - previousAmount), still routed
// through minor units - e.g. 17.99 - 15.49 in raw binary floating point is
// 2.4999999999999982, not 2.5.
export const periodDelta = (previousAmount, currentAmount) => {
  if (typeof previousAmount !== 'number' || typeof currentAmount !== 'number' || !Number.isFinite(previousAmount) || !Number.isFinite(currentAmount)) return null
  return fromMinorUnits(toMinorUnits(currentAmount) - toMinorUnits(previousAmount))
}

// The annualized dollar impact of moving from `previousAmount` to
// `currentAmount` at a given cadence - e.g. a $2.50/month increase on a
// monthly plan is $30.00/year; a $10/year increase on a yearly plan is
// $10.00/year. Both amounts must already be confirmed same-currency values -
// this function only does arithmetic, currency matching is
// priceChangeService's job.
export const annualizedImpact = (previousAmount, currentAmount, cadence) => {
  const periods = PERIODS_PER_YEAR[cadence]
  if (typeof previousAmount !== 'number' || typeof currentAmount !== 'number' || !Number.isFinite(previousAmount) || !Number.isFinite(currentAmount) || !periods) return null
  return fromMinorUnits((toMinorUnits(currentAmount) - toMinorUnits(previousAmount)) * periods)
}

// Percentage change is cadence/currency-agnostic (a ratio of two same-period
// amounts), still computed in minor units for consistency with the rest of
// this module. Returns null for a zero or non-numeric previous amount (a
// percentage against zero is undefined, not "infinite%").
export const percentChange = (previousAmount, currentAmount) => {
  if (typeof previousAmount !== 'number' || typeof currentAmount !== 'number' || !Number.isFinite(previousAmount) || !Number.isFinite(currentAmount) || previousAmount === 0) return null
  const previousMinor = toMinorUnits(previousAmount)
  const currentMinor = toMinorUnits(currentAmount)
  return ((currentMinor - previousMinor) / previousMinor) * 100
}
