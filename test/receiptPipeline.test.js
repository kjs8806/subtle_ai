import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRecommendations,
  createBillingEvent,
  createEvidence,
  createPriceObservation,
  createRecommendation,
  createRecommendationEvidence,
  createSubscriptionRecord,
  createSubscription,
  detectPriceChange,
  mergeSubscriptionDetections,
  normalizeMerchant,
  parseReceipt,
} from '../src/services/receiptPipeline.js'
import { createPipelineRecords, monthlySpendFor } from '../src/data/subscriptionModel.js'
import { demoSubscriptions, savingsActions } from '../src/data/demoSubscriptions.js'

test('adapts all demo subscriptions through the subscription model', () => {
  const monthlySpend = monthlySpendFor(demoSubscriptions)
  const pipelineRecords = createPipelineRecords(demoSubscriptions)

  assert.equal(typeof monthlySpend, 'number')
  assert.equal(pipelineRecords.length, demoSubscriptions.length)
  assert.equal(pipelineRecords.filter(Boolean).length, demoSubscriptions.length)
  assert.equal(savingsActions.length > 0, true)
})

test('creates explicit domain entities as plain objects', () => {
  const evidence = createEvidence({ id: 'evidence-1', type: 'gmail_receipt', confidence: { score: 0.9, state: 'confirmed' } })
  const observation = createPriceObservation({ amount: 12, observedAt: '2026-08-19' })
  const billingEvent = createBillingEvent({ amount: 12, billedAt: '2026-08-19' })
  const recommendation = createRecommendation({ type: 'price_increase', evidenceIds: [evidence.id] })
  const subscription = createSubscription({ id: 'netflix', evidence: [evidence], priceHistory: [observation], billingHistory: [billingEvent] })

  assert.deepEqual(observation, { amount: 12, observedAt: '2026-08-19' })
  assert.deepEqual(billingEvent, { amount: 12, billedAt: '2026-08-19' })
  assert.deepEqual(createRecommendationEvidence(['evidence-1']), [{ evidenceId: 'evidence-1' }])
  assert.deepEqual(recommendation.evidence, [{ evidenceId: 'evidence-1' }])
  assert.equal(subscription.evidence[0].id, 'evidence-1')
})

test('normalizes known merchants and preserves unknown names', () => {
  assert.deepEqual(normalizeMerchant('billing@dropbox.com').canonicalService, 'Dropbox')
  assert.deepEqual(normalizeMerchant('billing@dropbox.com').category, 'Cloud storage')
  assert.deepEqual(normalizeMerchant('Acme service'), { canonicalService: 'Acme service', category: 'Other' })
})

test('parses a receipt with merchant, amount, cadence, and renewal date', () => {
  const { classification, evidence } = parseReceipt({
    id: 'receipt-1',
    subject: 'Netflix renewal receipt',
    sender: 'billing@netflix.com',
    body: 'Your monthly payment of $22.99 renews Sep 12, 2026.',
  })

  assert.equal(classification, 'subscription')
  assert.equal(evidence.canonicalService, 'Netflix')
  assert.equal(evidence.amount, 22.99)
  assert.equal(evidence.cadence, 'monthly')
  assert.equal(evidence.nextRenewal, 'Sep 12, 2026')
  assert.equal(evidence.confidence.state, 'confirmed')
  assert.equal(evidence.fieldObservations.canonicalService.provenance, 'confirmed', 'came from a known subscription template')
  assert.equal(evidence.classificationScore >= 5, true, 'classificationScore is tracked separately from evidence confidence')
})

test('canonicalService provenance is inferred (not confirmed) for a merchant outside the template catalog', () => {
  const { evidence } = parseReceipt({
    id: 'fitness-1',
    subject: 'Downtown Fitness Club',
    sender: '"Downtown Fitness Club" <billing@downtownfitness.example>',
    body: 'Downtown Fitness Club — your monthly membership renews September 1.',
  })

  assert.equal(evidence.canonicalService, 'Downtown Fitness Club')
  assert.equal(evidence.fieldObservations.canonicalService.provenance, 'inferred')
})

test('represents a missing amount as unknown instead of zero', () => {
  const { classification, evidence } = parseReceipt({
    id: 'receipt-without-amount',
    subject: 'Netflix renewal receipt',
    sender: 'billing@netflix.com',
    body: 'Your monthly plan renews Sep 12, 2026.',
  })

  assert.equal(classification, 'subscription')
  assert.equal(evidence.amount, null)
  assert.equal(evidence.confidence.state, 'inferred')
  assert.equal(createSubscriptionRecord(evidence).currentPrice, null)
})

test('a generic receipt with no recurrence or one-time signal is ambiguous, not auto-imported', () => {
  const result = parseReceipt({ id: 'partial-receipt', subject: 'Payment received' })

  assert.equal(result.classification, 'ambiguous')
  assert.equal(result.evidence, null)
  assert.equal(result.classifierResult.score, 0)
})

test('calculates monthly equivalents for annual subscriptions', () => {
  assert.equal(monthlySpendFor([
    { cost: 12, cadence: 'monthly' },
    { cost: 120, cadence: 'yearly' },
  ]), 22)
})

test('ignores text without receipt terms', () => {
  const result = parseReceipt({ id: 'message-1', subject: 'Hello', sender: 'friend@example.com', body: 'See you tomorrow.' })
  assert.equal(result.classification, 'not_receipt')
  assert.equal(result.evidence, null)
})

test('detects only increases in price history', () => {
  assert.deepEqual(detectPriceChange([{ amount: 10 }, { amount: 12 }]), {
    type: 'price_increase',
    previous: 10,
    current: 12,
    annualImpact: 24,
    reason: 'The same subscription was observed at a higher price in a later receipt.',
  })
  assert.equal(detectPriceChange([{ amount: 12 }, { amount: 10 }]), null)
})

test('merges repeated detections and keeps the latest observed price', () => {
  const first = parseReceipt({ id: 'receipt-1', subject: 'Netflix payment receipt', sender: 'billing@netflix.com', body: '$10 monthly' }).evidence
  const second = parseReceipt({ id: 'receipt-2', subject: 'Netflix payment receipt', sender: 'billing@netflix.com', body: '$12 monthly' }).evidence
  const records = mergeSubscriptionDetections([
    createSubscriptionRecord(first),
    createSubscriptionRecord(second),
  ])

  assert.equal(records.length, 1)
  assert.equal(records[0].evidence.length, 2)
  assert.equal(records[0].currentPrice, 12)
})

test('links recommendation evidence for known overlapping services', () => {
  const dropboxEvidence = parseReceipt({ id: 'dropbox-1', subject: 'Dropbox payment receipt', sender: 'billing@dropbox.com', body: '$10 monthly' }).evidence
  const googleEvidence = parseReceipt({ id: 'google-1', subject: 'Google One payment receipt', sender: 'billing@google.com', body: '$12 monthly' }).evidence
  const dropbox = createSubscriptionRecord(dropboxEvidence)
  const google = createSubscriptionRecord(googleEvidence)
  const recommendations = buildRecommendations(dropbox, [google])

  assert.equal(recommendations[0].type, 'possible_overlap')
  assert.deepEqual(recommendations[0].evidenceIds, ['evidence-dropbox-1', 'evidence-google-1'])
})

test('does not infer overlap from category alone', () => {
  const netflix = createSubscriptionRecord(parseReceipt({ id: 'netflix-1', subject: 'Netflix payment receipt', sender: 'billing@netflix.com', body: '$10 monthly' }).evidence)
  const spotify = createSubscriptionRecord(parseReceipt({ id: 'spotify-1', subject: 'Spotify payment receipt', sender: 'billing@spotify.com', body: '$12 monthly' }).evidence)

  assert.deepEqual(buildRecommendations(netflix, [spotify]), [])
})