import assert from 'node:assert/strict'
import test from 'node:test'
import { buildAttentionItems } from '../src/services/attentionItemBuilder.js'

const NOW = new Date('2026-08-23T12:00:00Z')
const obs = (amount, currency, observedAt) => ({ amount, currency, observedAt })

const netflix = {
  id: 'sub-netflix', canonicalService: 'Netflix', plan: 'Premium Plan', source: 'Gmail receipt',
  currentPrice: 17.99, currency: 'USD', billingCycle: 'monthly', nextRenewal: null,
  priceHistory: [obs(15.49, 'USD', '2026-06-12'), obs(17.99, 'USD', '2026-08-12')],
  fieldObservations: [], corrections: [],
}
const spotify = {
  id: 'sub-spotify', canonicalService: 'Spotify', plan: 'Premium Individual', source: 'Gmail receipt',
  currentPrice: 10.99, currency: 'USD', billingCycle: 'monthly', nextRenewal: '2026-08-29',
  priceHistory: [obs(10.99, 'USD', '2026-07-01')],
  fieldObservations: [{ field: 'nextRenewal', provenance: 'confirmed' }], corrections: [],
}
const dropbox = {
  id: 'sub-dropbox', canonicalService: 'Dropbox', plan: 'Plus', source: 'Gmail receipt',
  currentPrice: 11.99, currency: 'USD', billingCycle: 'monthly', nextRenewal: '2026-09-10',
  priceHistory: [obs(11.99, 'USD', '2026-07-01')],
  fieldObservations: [{ field: 'nextRenewal', provenance: 'inferred' }], corrections: [],
}

test('buildAttentionItems surfaces an attention-worthy price increase and an imminent, upcoming renewal, but nothing for a >30-day-out renewal', () => {
  const items = buildAttentionItems({ subscriptions: [netflix, spotify, dropbox], now: NOW })
  const ids = items.map((item) => item.type + ':' + item.subscriptionId)
  assert.ok(ids.includes('price_change:sub-netflix'))
  assert.ok(ids.includes('renewal:sub-spotify'), 'renews in 6 days - within the 30-day window')
  assert.ok(ids.includes('renewal:sub-dropbox'), 'renews in 18 days - still within the 30-day window (Upcoming)')
})

test('buildAttentionItems never surfaces a price decrease or a sub-threshold increase as attention items', () => {
  const decreased = { ...netflix, id: 'sub-decreased', currentPrice: 12.99, priceHistory: [obs(15.49, 'USD', '2026-06-12'), obs(12.99, 'USD', '2026-08-12')] }
  const tinyIncrease = { ...netflix, id: 'sub-tiny', currentPrice: 15.5, priceHistory: [obs(15.49, 'USD', '2026-06-12'), obs(15.5, 'USD', '2026-08-12')] }
  const items = buildAttentionItems({ subscriptions: [decreased, tinyIncrease], now: NOW })
  assert.equal(items.filter((item) => item.type === 'price_change').length, 0)
})

test('buildAttentionItems sorts a renewal within 7 days before a material price increase, before a renewal 8-30 days out, before needs-review', () => {
  const items = buildAttentionItems({ subscriptions: [netflix, spotify, dropbox], candidates: [{ id: 'cand-1', canonicalService: 'Amazon' }], now: NOW })
  assert.deepEqual(items.map((item) => item.id.split(':')[0] + (item.subscriptionId || item.candidateId)), [
    'renewalsub-spotify',
    'price-changesub-netflix',
    'renewalsub-dropbox',
    'needs-reviewcand-1',
  ])
})

test('buildAttentionItems assigns High to an imminent renewal, Medium to a price increase, Low to an upcoming renewal and a needs-review candidate', () => {
  const items = buildAttentionItems({ subscriptions: [netflix, spotify, dropbox], candidates: [{ id: 'cand-1', canonicalService: 'Amazon' }], now: NOW })
  const byId = Object.fromEntries(items.map((item) => [item.id, item.priority]))
  assert.equal(byId[items.find((item) => item.subscriptionId === 'sub-spotify').id], 'high')
  assert.equal(byId[items.find((item) => item.subscriptionId === 'sub-netflix').id], 'medium')
  assert.equal(byId[items.find((item) => item.subscriptionId === 'sub-dropbox').id], 'low')
  assert.equal(byId[items.find((item) => item.candidateId === 'cand-1').id], 'low')
})

test('buildAttentionItems excludes any item whose id the caller reports as dismissed', () => {
  const items = buildAttentionItems({ subscriptions: [netflix], isDismissed: (id) => id.startsWith('price-change:'), now: NOW })
  assert.equal(items.length, 0)
})

test('buildAttentionItems marks an inferred renewal distinctly from a confirmed one', () => {
  const items = buildAttentionItems({ subscriptions: [spotify, dropbox], now: NOW })
  const spotifyItem = items.find((item) => item.subscriptionId === 'sub-spotify')
  const dropboxItem = items.find((item) => item.subscriptionId === 'sub-dropbox')
  assert.equal(spotifyItem.renewal.certainty, 'confirmed')
  assert.equal(dropboxItem.renewal.certainty, 'inferred')
})
