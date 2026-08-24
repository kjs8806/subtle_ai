// Shared field-level provenance logic for FEATURE-002 corrections, used by
// both the Subscription Detail UI (src/ui/subscriptionDetail.js) and
// FEATURE-003's backend intelligence services (renewalDerivationService.js,
// priceChangeService.js) - both need the identical answer to "is this field
// a user correction, a confirmed receipt fact, or an inferred one," so the
// logic lives once here rather than being reimplemented per caller.
//
// Operates directly on a backend subscription record shape (the same shape
// GET /api/v1/subscriptions/:id returns, and that toDisplayItem() stashes
// unmodified as item.pipelineRecord) - not the frontend display-item wrapper.

// Maps the UI-facing field keys used elsewhere to the snake_case field name
// subscription_corrections/correction_conflicts record server-side (see
// migrations/008_feature_002_corrections.sql and server/app.js's
// CORRECTION_FIELD_MAP).
export const CORRECTION_FIELD_FOR = { canonicalService: 'canonical_service', plan: 'plan', amount: 'current_price', currency: 'currency', cadence: 'billing_cycle', nextRenewal: 'next_renewal' }

// `record` is a raw backend subscription record (corrections/
// fieldObservations/confidence as returned by the repository); `source` is
// the display-facing source label (e.g. "Gmail receipt", "Manual entry").
export const fieldProvenanceFor = (record, field, source) => {
  if (source === 'Manual entry') return 'User provided'
  const correctionField = CORRECTION_FIELD_FOR[field]
  const hasActiveCorrection = correctionField && (record?.corrections || []).some(correction => correction.field === correctionField)
  if (hasActiveCorrection) return 'Confirmed by you'
  const observation = [...(record?.fieldObservations || [])].reverse().find(entry => entry.field === field)
  const state = observation?.provenance || record?.confidence?.state
  if (state === 'confirmed') return `Confirmed from ${source}`
  if (state === 'inferred') return `Inferred from ${source}`
  return `Source: ${source || 'Not provided'}`
}

// Convenience wrapper matching the frontend's existing item shape
// ({ source, pipelineRecord }) - subscriptionDetail.js's fieldProvenance is
// this function.
export const fieldProvenance = (item, field) => fieldProvenanceFor(item?.pipelineRecord, field, item?.source)
