import { AnnualImpactCalculator } from './annualImpactCalculator.js'

// FEATURE-003: deterministic, currency-safe price-change detection between
// two consecutive price_observations for the same subscription. Pure domain
// logic - no I/O, no database access. Callers (repository methods) are
// responsible for finding the right "previous"/"current" pair and for
// persisting the result as a price_change_events row.
//
// Money correctness: every comparison happens in integer cents
// (Math.round(amount * 100)), never on binary-float dollar amounts, per the
// Tech Lead's guidance. `percentChangeBp` is basis points (5% = 500) and is
// itself an exact integer once previous/current are in cents.
const RULE_VERSION = 'v1'
const MATERIAL_PERCENT_BP = 500 // 5%
const MATERIAL_ANNUALIZED_CENTS = 2400 // $24/year (or CAD 24/year - same-currency only)

const toCents = (amount) => (typeof amount === 'number' && Number.isFinite(amount) ? Math.round(amount * 100) : null)

export const PriceChangeService = {
  // detect({ previousObservation, currentObservation, cadence }) -> event | null
  //   previousObservation / currentObservation: { amount, currency } (price_observations rows)
  //   cadence: the subscription's current billing_cycle ('monthly'|'yearly'|null) -
  //     already correction-precedence-resolved by the caller; this service
  //     never reads corrections itself.
  //
  // Returns null when there is nothing to compare (no previous observation,
  // mismatched/unknown currency, or no actual change). Returns an event
  // object for *every* real increase or decrease - materiality only decides
  // whether it should surface as an attention item, not whether it is
  // recorded at all.
  detect({ previousObservation, currentObservation, cadence = null } = {}) {
    if (!previousObservation || !currentObservation) return null // first-ever observation: nothing to compare

    const currency = previousObservation.currency
    // Never compare amounts across different - or unknown - currencies.
    if (!currency || !currentObservation.currency || currency !== currentObservation.currency) return null

    const previousPriceCents = toCents(previousObservation.amount)
    const currentPriceCents = toCents(currentObservation.amount)
    if (previousPriceCents === null || currentPriceCents === null || previousPriceCents <= 0) return null
    if (currentPriceCents === previousPriceCents) return null // no change: no event at all

    const direction = currentPriceCents > previousPriceCents ? 'increase' : 'decrease'
    const deltaCents = currentPriceCents - previousPriceCents
    const percentChangeBp = Math.round((deltaCents * 10000) / previousPriceCents)
    const annualizedDeltaCents = AnnualImpactCalculator.annualizeCents(deltaCents, cadence)

    // Product decision: only a material *increase* is worth the user's
    // attention. A decrease always updates history, never itself the
    // reason for an attention item, regardless of magnitude.
    const isMaterial = direction === 'increase'
      && (percentChangeBp >= MATERIAL_PERCENT_BP || (annualizedDeltaCents !== null && annualizedDeltaCents >= MATERIAL_ANNUALIZED_CENTS))

    return {
      currency,
      previousPriceCents,
      currentPriceCents,
      direction,
      percentChangeBp,
      annualizedDeltaCents,
      isMaterial,
      ruleVersion: RULE_VERSION,
    }
  },
}
