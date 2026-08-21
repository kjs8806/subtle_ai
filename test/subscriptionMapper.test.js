import assert from 'node:assert/strict'
import test from 'node:test'
import { toDisplayItem, toManualDisplayItem } from '../src/services/subscriptionMapper.js'

const record = {
  id: 'sub-1',
  canonicalService: 'Netflix',
  rawMerchant: 'netflix.com',
  plan: null,
  currentPrice: 22.99,
  billingCycle: 'monthly',
  nextRenewal: '2026-09-12T00:00:00.000Z',
  status: 'active',
  source: 'Gmail receipt',
  evidence: [{ id: 'ev-1', confidence: 0.74, receivedAt: '2026-08-19T09:00:00.000Z' }],
  priceHistory: [{ amount: 22.99, observedAt: '2026-08-19T09:00:00.000Z' }],
  billingHistory: [{ amount: 22.99, billedAt: '2026-08-19T09:00:00.000Z', evidenceId: 'ev-1' }],
  fieldObservations: [{ field: 'amount', value: 22.99, provenance: 'confirmed', confidence: 0.74, evidenceId: 'ev-1' }],
}

test('toDisplayItem maps a real backend subscription record into the UI item shape', () => {
  const item = toDisplayItem(record)
  assert.equal(item.id, 'sub-1')
  assert.equal(item.remoteId, 'sub-1')
  assert.equal(item.name, 'Netflix')
  assert.equal(item.cost, 22.99)
  assert.equal(item.cadence, 'monthly')
  assert.equal(item.next, '2026-09-12T00:00:00.000Z')
  assert.equal(item.source, 'Gmail receipt')
  assert.equal(item.confirmed, '2026-08-19T09:00:00.000Z')
  assert.deepEqual(item.history, [['2026-08-19T09:00:00.000Z', '$22.99']])
  assert.deepEqual(item.bills, [['2026-08-19T09:00:00.000Z', '$22.99']])
  assert.equal(item.pipelineRecord, record, 'the raw record is kept for field-level provenance lookups')
})

test('toDisplayItem maps the real confidence score to the approved qualitative bands, never a raw number', () => {
  const withConfidence = (confidence) => ({ ...record, fieldObservations: [{ field: 'amount', confidence }] })
  assert.equal(toDisplayItem(withConfidence(0.8)).confidence, 'High confidence')
  assert.equal(toDisplayItem(withConfidence(0.5)).confidence, 'Medium confidence')
  assert.equal(toDisplayItem(withConfidence(0.1)).confidence, 'Low confidence')
  assert.equal(toDisplayItem({ ...record, fieldObservations: [] }).confidence, 'Receipt evidence')
})

test('toDisplayItem reads confidence consistently regardless of which repository produced the record', () => {
  // postgresRepository returns evidence[].confidence as a plain number;
  // memoryRepository returns it as {score,state} instead. fieldObservations is
  // a plain number in both, so the mapper must read from there, not evidence.
  const postgresShaped = { ...record, evidence: [{ confidence: 0.9 }], fieldObservations: [{ field: 'amount', confidence: 0.9 }] }
  const memoryShaped = { ...record, evidence: [{ confidence: { score: 0.9, state: 'confirmed' } }], fieldObservations: [{ field: 'amount', confidence: 0.9 }] }
  assert.equal(toDisplayItem(postgresShaped).confidence, 'High confidence')
  assert.equal(toDisplayItem(memoryShaped).confidence, 'High confidence')
})

test('toDisplayItem never fabricates a name, plan, or renewal date for missing fields', () => {
  const sparse = toDisplayItem({ id: 'sub-2', canonicalService: null, plan: null, currentPrice: null, billingCycle: null, nextRenewal: null, evidence: [], priceHistory: [], billingHistory: [] })
  assert.equal(sparse.name, 'Unknown service')
  assert.equal(sparse.plan, 'Plan not provided')
  assert.equal(sparse.next, 'Not provided')
  assert.equal(sparse.cost, null)
})

test('toManualDisplayItem preserves the exact manual-entry shape (client-only, no backend record)', () => {
  const item = toManualDisplayItem({ name: 'Gym', cost: 45, cadence: 'monthly' })
  assert.equal(item.name, 'Gym')
  assert.equal(item.cost, 45)
  assert.equal(item.cadence, 'monthly')
  assert.equal(item.source, 'Manual entry')
  assert.equal(item.confidence, 'User provided')
  assert.equal(item.remoteId, undefined, 'manual items have no backend id to re-fetch detail with')
  assert.deepEqual(item.history, [])
  assert.deepEqual(item.bills, [])
})
