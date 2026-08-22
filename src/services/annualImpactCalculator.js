// FEATURE-003: the single place that turns a per-billing-period integer-cents
// amount into an annualized integer-cents amount. Used by PriceChangeService
// for annualized impact/materiality, and available to any other domain
// service that needs the same "x12 for monthly, x1 for yearly, null if
// cadence unknown" arithmetic, so it is never duplicated inline.
//
// Deliberately integer cents in, integer cents out - never binary
// floating-point dollars - per the Tech Lead's money-correctness guidance.
const MONTHLY = 'monthly'
const YEARLY = 'yearly'

export const AnnualImpactCalculator = {
  // annualizeCents(50, 'monthly') -> 600 ($6.00/year from a $0.50/month delta)
  // annualizeCents(2400, 'yearly') -> 2400 (already an annual figure)
  // annualizeCents(50, 'weekly'|null|undefined) -> null (never guess)
  annualizeCents(perPeriodCents, cadence) {
    if (typeof perPeriodCents !== 'number' || !Number.isFinite(perPeriodCents)) return null
    if (!Number.isInteger(perPeriodCents)) return null
    if (cadence === MONTHLY) return perPeriodCents * 12
    if (cadence === YEARLY) return perPeriodCents
    return null
  },
}
