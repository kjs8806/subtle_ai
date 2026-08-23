import { buildRecommendations, normalizeMerchant } from './receiptPipeline.js'

// Maps buildRecommendations()'s engine-facing recommendation shape
// ({type, priority, ...}) into the UI-facing action-card shape consumed by
// actionCard() in src/ui/attention.js ({id, label, affectedServices, body,
// impactLabel, saving, secondary}). Kept separate from receiptPipeline.js so
// the engine itself stays UI-agnostic.
//
// Price-change detection is handled separately by
// src/services/priceChangeService.js and surfaced via GET /api/v1/attention
// (FEATURE-003) - this engine now only covers overlap detection.
const money = (value) => `$${Number(value).toFixed(2)}`
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 }

const overlapItem = (record, related) => ({
  id: `overlap-${[record.id, related.id].sort().join('-')}`,
  priority: 'high',
  label: 'Potential overlap',
  affectedServices: [record.canonicalService, related.canonicalService],
  body: `Both ${record.canonicalService} and ${related.canonicalService} provide ${(record.category || '').toLowerCase()} services.`,
  impactLabel: 'Potential savings',
  saving: `${money(Math.min(record.currentPrice || 0, related.currentPrice || 0) * 12)}/year`,
  secondary: 'Keep both',
})

// records are the raw backend subscription objects (as returned by
// GET /api/v1/subscriptions, e.g. via toDisplayItem's item.pipelineRecord) -
// they carry priceHistory/evidence/canonicalService but never a `category`
// (that's a demo-fixture-only field), so it's derived here before calling
// into the engine, which needs it for the overlap reason text.
export const buildActionItems = (records = []) => {
  const enriched = records.map((record) => ({ ...record, category: record.category || normalizeMerchant(record.canonicalService).category }))
  const byId = new Map(enriched.map((record) => [record.id, record]))
  const items = []
  for (const record of enriched) {
    for (const recommendation of buildRecommendations(record, enriched)) {
      if (recommendation.type === 'possible_overlap') {
        const related = byId.get(recommendation.relatedSubscriptionId)
        if (related) items.push(overlapItem(record, related))
      }
    }
  }
  // Overlap is symmetric - both sides of a pair independently detect each
  // other, but overlapItem's id is order-independent, so this collapses the
  // two into a single card.
  const seen = new Set()
  const deduped = items.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)))
  return deduped.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
}
