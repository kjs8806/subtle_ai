import assert from 'node:assert/strict'
import test from 'node:test'
import { buildActionItems } from '../src/services/recommendationEngine.js'
import { createSubscriptionRecord, mergeSubscriptionDetections, parseReceipt } from '../src/services/receiptPipeline.js'

const record = (id, subject, sender, body) => createSubscriptionRecord(parseReceipt({ id, subject, sender, body }).evidence)

test('buildActionItems surfaces a price-increase card for a subscription with a rising price history', () => {
  const first = record('receipt-1', 'Netflix payment receipt', 'billing@netflix.com', 'USD $10 monthly')
  const second = record('receipt-2', 'Netflix payment receipt', 'billing@netflix.com', 'USD $12 monthly')
  const [netflix] = mergeSubscriptionDetections([first, second])

  const items = buildActionItems([netflix])
  assert.equal(items.length, 1)
  assert.equal(items[0].label, 'Price increase detected')
  assert.deepEqual(items[0].affectedServices, ['Netflix'])
  assert.equal(items[0].saving, '+$24.00/year')
})

test('buildActionItems surfaces one deduped overlap card for a known overlapping pair', () => {
  const dropbox = record('dropbox-1', 'Dropbox payment receipt', 'billing@dropbox.com', 'USD $10 monthly')
  const googleOne = record('google-1', 'Google One payment receipt', 'billing@google.com', 'USD $12 monthly')

  const items = buildActionItems([dropbox, googleOne])
  assert.equal(items.length, 1, 'overlap is detected from both sides but must not be reported twice')
  assert.equal(items[0].label, 'Potential overlap')
  assert.deepEqual(items[0].affectedServices.sort(), ['Dropbox', 'Google One'])
  assert.equal(items[0].saving, '$120.00/year', 'saving is the cheaper of the two annualized')
})

test('buildActionItems returns nothing for a subscription with no price history or overlap', () => {
  const spotify = record('spotify-1', 'Spotify payment receipt', 'billing@spotify.com', 'USD $12 monthly')
  assert.deepEqual(buildActionItems([spotify]), [])
})
