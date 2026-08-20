import assert from 'node:assert/strict'
import test from 'node:test'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'

const receipt = (sourceId, amount = 10) => ({
  sourceId,
  canonicalService: 'Netflix',
  rawMerchant: 'billing',
  amount,
  cadence: 'monthly',
  nextRenewal: null,
  receivedAt: '2026-08-19T09:00:00.000Z',
  confidence: { score: 0.9, state: 'confirmed' },
  excerpt: 'Netflix receipt',
})

const connectedRepository = () => {
  const repository = createMemoryRepository()
  repository.authorizeConnection('mock-user')
  return repository
}

test('processing one provider message twice creates no duplicate domain rows', () => {
  const repository = connectedRepository()
  const first = repository.persistParsedEvidence('mock-user', receipt('message-1'))
  const second = repository.persistParsedEvidence('mock-user', receipt('message-1'))
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(repository.listSubscriptions('mock-user').length, 1)
  assert.equal(second.subscription.evidence.length, 1)
  assert.equal(second.subscription.billingHistory.length, 1)
})

test('a later receipt with matching merchant evidence enriches one subscription', () => {
  const repository = connectedRepository()
  const first = repository.persistParsedEvidence('mock-user', receipt('message-1', 10))
  const second = repository.persistParsedEvidence('mock-user', receipt('message-2', 12))
  assert.equal(second.subscription.id, first.subscription.id)
  assert.equal(second.subscription.evidence.length, 2)
  assert.equal(second.subscription.billingHistory.length, 2)
  assert.equal(second.subscription.currentPrice, 12)
})

test('same canonical service with a different raw merchant does not silently merge', () => {
  const repository = connectedRepository()
  const first = repository.persistParsedEvidence('mock-user', receipt('message-1'))
  const second = repository.persistParsedEvidence('mock-user', { ...receipt('message-2'), rawMerchant: 'partner-billing' })
  assert.notEqual(second.subscription.id, first.subscription.id)
  assert.equal(repository.listSubscriptions('mock-user').length, 2)
})

test('failed persistence leaves no partial subscription or evidence', () => {
  const repository = connectedRepository()
  assert.throws(() => repository.persistParsedEvidence('mock-user', receipt('message-1'), { failBeforeCommit: true }))
  assert.deepEqual(repository.listSubscriptions('mock-user'), [])
})

test('subscription and scan reads enforce ownership', () => {
  const repository = connectedRepository()
  repository.createUser({ id: 'other-user', email: 'other@example.com', name: 'Other' })
  const subscription = repository.persistParsedEvidence('mock-user', receipt('message-1')).subscription
  const scan = repository.beginScan('mock-user')
  assert.equal(repository.getSubscription('other-user', subscription.id), null)
  assert.equal(repository.getScan('other-user', scan.id), null)
  assert.equal(repository.getScan('mock-user', scan.id).id, scan.id)
})
