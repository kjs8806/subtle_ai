// Maps a backend subscription record (GET /api/v1/subscriptions,
// GET /api/v1/subscriptions/:id) into the UI's display-item shape consumed by
// src/ui/overview.js and src/ui/subscriptionDetail.js. Kept as a pure function,
// separate from src/main.js's DOM wiring, so the mapping itself is unit-testable
// without a DOM.
const TONES = ['blue', 'navy', 'purple', 'green', 'red']
const toneFor = (name) => TONES[[...String(name || '')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TONES.length]
const money = (value) => typeof value === 'number' ? `$${value.toFixed(2)}` : 'Price not provided'
// Matches the qualitative confidence labels already used by DESIGN-001's "How do
// we know?" section (e.g. demo fixtures' "High confidence"/"Medium confidence"),
// rather than introducing a new raw-percentage presentation.
const confidenceLabel = (score) => {
  if (typeof score !== 'number') return 'Receipt evidence'
  if (score >= 0.7) return 'High confidence'
  if (score >= 0.4) return 'Medium confidence'
  return 'Low confidence'
}
// evidence[].confidence's shape differs between repositories (a plain number in
// postgresRepository, an {score,state} object in memoryRepository) - read from
// fieldObservations[].confidence instead, which both repositories return as a
// consistent plain number.
const firstFieldConfidence = (record) => record.fieldObservations?.find((observation) => typeof observation.confidence === 'number')?.confidence
// evidence[].receivedAt is a timestamptz ISO string, never meant for direct
// display - format it the same way approved demo fixtures format dates
// ("Sep 12, 2026") rather than showing the raw ISO string.
const formatDate = (value) => {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const toDisplayItem = (record) => ({
  id: record.id,
  remoteId: record.id,
  status: record.status || 'active',
  name: record.canonicalService || 'Unknown service',
  plan: record.plan || 'Plan not provided',
  category: 'Other',
  cost: record.currentPrice,
  // Additive field only - the UI still renders a currency-neutral `$` (valid
  // for both supported currencies) rather than a "USD"/"CAD" label, so a null
  // currency here never displays as a false USD claim. See
  // docs/engineering/FEATURE_001_CURRENCY.md.
  currency: record.currency ?? null,
  cadence: record.billingCycle === 'yearly' ? 'yearly' : 'monthly',
  next: record.nextRenewal || 'Not provided',
  icon: (record.canonicalService || '?').charAt(0).toUpperCase(),
  tone: toneFor(record.canonicalService),
  takeTone: 'review',
  signal: 'New from receipt',
  analysisTitle: 'Receipt-backed discovery',
  analysisCopy: 'Review the detected fields and receipt evidence for this subscription.',
  source: record.source || 'Gmail receipt',
  confirmed: formatDate(record.evidence?.[0]?.receivedAt) || 'Not provided',
  confidence: confidenceLabel(firstFieldConfidence(record)),
  history: (record.priceHistory || []).map((value) => [value.observedAt, money(value.amount)]),
  bills: (record.billingHistory || []).map((value) => [value.billedAt, money(value.amount)]),
  pipelineRecord: record,
})

// Manual entries are frontend-only (no manual-subscription API exists on the
// backend) and must keep coexisting with Gmail-derived ones after any refresh.
export const toManualDisplayItem = ({ name, cost, cadence }) => ({
  id: `manual-${Date.now()}`,
  name,
  plan: 'Added manually',
  category: 'Other',
  cost,
  currency: null,
  cadence,
  next: 'Not provided',
  icon: name.charAt(0).toUpperCase(),
  tone: 'navy',
  takeTone: 'good',
  signal: '',
  source: 'Manual entry',
  confirmed: null,
  confidence: 'User provided',
  history: [],
  bills: [],
})
