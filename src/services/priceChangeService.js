import { annualizedImpact, percentChange, periodDelta } from './annualImpactCalculator.js'

// PO-approved FEATURE-003 materiality threshold (GitHub issue #22, Product
// Owner decisions #1): a price increase becomes a Worth-your-attention item
// when it's >=5% OR >=$24/year in the subscription's own currency - either
// condition is sufficient, and the $24 figure is never FX-converted (it's
// 24 units of whatever currency the subscription is actually billed in).
// A confirmed decrease updates history but is never attention-worthy in
// FEATURE-003.
const PERCENT_THRESHOLD = 5
const ANNUAL_THRESHOLD = 24

// Walks same-currency history (assumed chronological, oldest first - see
// memoryRepository.js/postgresRepository.js's ORDER BY observed_at) backward
// from the most recent entry while it still matches the current price, to
// find both the earliest observation of that current price (when it was
// "first seen" / the subscription "increased on") and the observation
// immediately before that run began ("previous price"). Robust to a
// FEATURE-002 correction having changed the live current price without ever
// adding a new price_observation row (corrections only ever touch the
// subscription's own current_price/currency columns, never price history -
// see server/app.js's PATCH /subscriptions/:id): in that case no trailing
// observation matches the corrected price, so firstSeenEntry comes back
// null (there is no receipt-observed date for it) while previousEntry still
// resolves to the last real observation - the correction is simply "current"
// now, per the precedence Tech Lead guidance requires.
const analyzeHistory = (priceHistory, currentPrice, currency) => {
  const sameCurrency = priceHistory.filter((entry) => entry.currency === currency && typeof entry.amount === 'number')
  let i = sameCurrency.length - 1
  while (i >= 0 && sameCurrency[i].amount === currentPrice) i--
  return { previousEntry: i >= 0 ? sameCurrency[i] : null, firstSeenEntry: sameCurrency[i + 1] ?? null }
}

// Pure, deterministic price-change detection for one subscription's current
// state. Returns null - never a guessed value - whenever there isn't enough
// same-currency evidence to safely compare: missing current price/currency/
// cadence, no prior same-currency observation, or an unrecognized cadence.
// Per Tech Lead guidance, currency must be known and matching before any
// comparison; per Product Owner guidance, uncertain prices must never
// manufacture a price-change item.
export const detectPriceChange = ({ currentPrice, currency, cadence, priceHistory = [] }) => {
  if (typeof currentPrice !== 'number' || !currency || !cadence) return null
  const { previousEntry, firstSeenEntry } = analyzeHistory(priceHistory, currentPrice, currency)
  if (!previousEntry) return null
  const previousPrice = previousEntry.amount
  const annualImpact = annualizedImpact(previousPrice, currentPrice, cadence)
  const percent = percentChange(previousPrice, currentPrice)
  if (annualImpact === null || percent === null) return null
  const changeType = currentPrice > previousPrice ? 'increase' : 'decrease'
  const isAttentionWorthy = changeType === 'increase' && (Math.abs(percent) >= PERCENT_THRESHOLD || Math.abs(annualImpact) >= ANNUAL_THRESHOLD)
  return {
    changeType,
    currency,
    cadence,
    previousPrice,
    currentPrice,
    perPeriodDelta: periodDelta(previousPrice, currentPrice),
    percentChange: percent,
    annualImpact,
    // The date the *current* price was first established - not the previous
    // price's date. Null when the current price came from a FEATURE-002
    // correction rather than a receipt (no observation matches it).
    firstSeenAt: firstSeenEntry?.observedAt ?? null,
    isAttentionWorthy,
  }
}
