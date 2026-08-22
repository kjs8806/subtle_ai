// FEATURE-002 repository-level contract tests: corrections/conflicts,
// subscription rejection, ambiguous-candidate review, and account isolation.
// The same test bodies run against both createMemoryRepository() and, when a
// PostgreSQL test database is reachable, createPostgresRepository() - both
// repositories implement the same interface and must behave identically.
import assert from 'node:assert/strict'
import test, { after, before } from 'node:test'
import { Pool } from 'pg'
import { createMemoryRepository } from '../server/persistence/memoryRepository.js'
import { createPostgresRepository } from '../server/persistence/postgresRepository.js'
import { runMigrations } from '../server/persistence/migrations.js'

const receipt = (sourceId, overrides = {}) => ({
  sourceId,
  canonicalService: 'Netflix',
  rawMerchant: 'billing',
  amount: 10,
  currency: 'USD',
  cadence: 'monthly',
  nextRenewal: null,
  receivedAt: '2026-08-19T09:00:00.000Z',
  confidence: { score: 0.9, state: 'confirmed' },
  excerpt: 'Netflix receipt',
  ...overrides,
  // Field observations must reflect any amount/currency override too, so the
  // conflict-detection path (which reads from fieldObservations, not the top
  // -level amount/currency) sees the same overridden values.
  fieldObservations: {
    canonicalService: { value: 'Netflix', provenance: 'confirmed' },
    amount: { value: overrides.amount ?? 10, provenance: 'confirmed' },
    currency: { value: overrides.currency ?? 'USD', provenance: 'confirmed' },
    cadence: { value: 'monthly', provenance: 'confirmed' },
    ...overrides.fieldObservations,
  },
})

const candidateEvidence = (sourceId, overrides = {}) => ({
  canonicalService: 'Downtown Fitness',
  rawMerchant: 'downtownfitness',
  amount: null,
  currency: null,
  cadence: null,
  nextRenewal: null,
  sourceId,
  receivedAt: '2026-08-19T09:00:00.000Z',
  excerpt: 'Downtown Fitness receipt',
  ...overrides,
})

const runContractTests = (label, createRepository, testFn = test) => {
  testFn(`[${label}] a correction takes precedence over new scan evidence, which surfaces as a conflict instead of overwriting`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-a@example.com`, name: 'A' })
    await repository.authorizeConnection(user.id)
    const first = await repository.persistParsedEvidence(user.id, receipt('msg-1'))
    const subscriptionId = first.subscription.id

    const corrected = await repository.applyCorrection(user.id, subscriptionId, 'current_price', 15)
    assert.equal(corrected.subscription.currentPrice, 15)

    const second = await repository.persistParsedEvidence(user.id, receipt('msg-2', { amount: 12 }))
    assert.equal(second.subscription.currentPrice, 15, 'the correction is not silently overwritten by new evidence')
    assert.equal(second.subscription.conflicts.length, 1, 'the conflicting new evidence is surfaced, not discarded')
    const conflict = second.subscription.conflicts[0]
    assert.equal(conflict.field, 'current_price')
    assert.equal(conflict.conflictingValue, 12)
    assert.equal(second.subscription.evidence.length, 2, 'the new evidence is still recorded, append-only')

    const accepted = await repository.acceptConflict(user.id, conflict.id)
    assert.equal(accepted.subscription.currentPrice, 12, 'accepting the conflict supersedes the correction with the new value')
    assert.equal(accepted.subscription.conflicts.length, 0, 'an accepted conflict is no longer open')
    const activeCorrection = accepted.subscription.corrections.find((c) => c.field === 'current_price')
    assert.equal(activeCorrection.value, 12, 'the active correction now reflects the accepted value')

    const third = await repository.persistParsedEvidence(user.id, receipt('msg-3', { amount: 20 }))
    assert.equal(third.subscription.currentPrice, 12, 'the (now-accepted) correction still takes precedence over further new evidence')
    const dismissable = third.subscription.conflicts[0]
    await repository.dismissConflict(user.id, dismissable.id)
    const afterDismiss = await repository.getSubscription(user.id, subscriptionId)
    assert.equal(afterDismiss.currentPrice, 12, 'dismissing a conflict does not change the correction')
    assert.equal(afterDismiss.conflicts.length, 0, 'a dismissed conflict is acknowledged, not left open')
  })

  testFn(`[${label}] rejecting a subscription is idempotent and non-destructive`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-b@example.com`, name: 'B' })
    await repository.authorizeConnection(user.id)
    const first = await repository.persistParsedEvidence(user.id, receipt('reject-msg-1'))
    const subscriptionId = first.subscription.id

    const rejected = await repository.rejectSubscription(user.id, subscriptionId)
    assert.equal(rejected.status, 'rejected')
    assert.deepEqual((await repository.listSubscriptions(user.id)).map((s) => s.id), [], 'excluded from the default listing immediately')

    const duplicate = await repository.persistParsedEvidence(user.id, receipt('reject-msg-1'))
    assert.equal(duplicate.created, false, 'reprocessing the identical message is still a no-op')

    const enriched = await repository.persistParsedEvidence(user.id, receipt('reject-msg-2', { amount: 11 }))
    assert.equal(enriched.subscription.id, subscriptionId, 'new evidence for the same merchant attaches to the same row')
    assert.equal(enriched.subscription.status, 'rejected', 'reprocessing must not flip status back to active')
    assert.equal(enriched.subscription.evidence.length, 2, 'evidence keeps accumulating, never destroyed')
    assert.deepEqual((await repository.listSubscriptions(user.id)).map((s) => s.id), [], 'still excluded from the default listing and spend totals')
  })

  testFn(`[${label}] an ambiguous candidate is reviewed, never counted as active, and reprocessing does not duplicate it`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-c@example.com`, name: 'C' })
    await repository.authorizeConnection(user.id)

    const first = await repository.persistCandidate(user.id, candidateEvidence('candidate-msg-1'))
    assert.equal(first.created, true)
    const duplicate = await repository.persistCandidate(user.id, candidateEvidence('candidate-msg-1'))
    assert.equal(duplicate.created, false, 'reprocessing the identical ambiguous message does not create a duplicate candidate')
    const again = await repository.persistCandidate(user.id, candidateEvidence('candidate-msg-2'))
    assert.equal(again.candidateId, first.candidateId, 'a second message for the same merchant enriches the same pending candidate')

    const pending = await repository.listCandidates(user.id)
    assert.equal(pending.length, 1)
    assert.equal(pending[0].evidence.length, 2)
    assert.deepEqual(await repository.listSubscriptions(user.id), [], 'a pending candidate is never an active subscription or spend')

    const confirmed = await repository.confirmCandidate(user.id, first.candidateId)
    assert.ok(confirmed.subscription)
    const activeList = await repository.listSubscriptions(user.id)
    assert.equal(activeList.length, 1, 'confirming creates exactly one subscription')
    assert.equal(activeList[0].evidence.length, 2, 'both pieces of candidate evidence moved onto the confirmed subscription')
    assert.deepEqual(await repository.listCandidates(user.id), [], 'a confirmed candidate is no longer pending')

    const otherUser = await repository.createUser({ email: `${label}-c2@example.com`, name: 'C2' })
    await repository.authorizeConnection(otherUser.id)
    const toReject = await repository.persistCandidate(otherUser.id, candidateEvidence('candidate-reject-1', { canonicalService: 'Yoga Studio', rawMerchant: 'yogastudio' }))
    await repository.rejectCandidate(otherUser.id, toReject.candidateId)
    const rejectedReprocessed = await repository.persistCandidate(otherUser.id, candidateEvidence('candidate-reject-2', { canonicalService: 'Yoga Studio', rawMerchant: 'yogastudio' }))
    assert.equal(rejectedReprocessed.candidateId, toReject.candidateId, 'reprocessing attaches to the existing rejected candidate, not a new one')
    assert.deepEqual(await repository.listCandidates(otherUser.id), [], 'a rejected candidate never appears as pending again')
    assert.deepEqual(await repository.listSubscriptions(otherUser.id), [], 'a rejected candidate never silently becomes a subscription')
  })

  testFn(`[${label}] confirming a candidate that reuses a previously-rejected subscription row makes it active and visible again`, async () => {
    const repository = await createRepository()
    const user = await repository.createUser({ email: `${label}-d@example.com`, name: 'D' })
    await repository.authorizeConnection(user.id)

    // Reject a real subscription at a given merge key.
    const original = await repository.persistParsedEvidence(user.id, receipt('reuse-msg-1', { canonicalService: 'Gym Membership', rawMerchant: 'thegym' }))
    const subscriptionId = original.subscription.id
    await repository.rejectSubscription(user.id, subscriptionId)
    assert.deepEqual(await repository.listSubscriptions(user.id), [], 'rejected in the meantime')

    // A later ambiguous email for the exact same merge key becomes a pending
    // candidate (a separate table/row, not the rejected subscription).
    const candidate = await repository.persistCandidate(user.id, candidateEvidence('reuse-candidate-1', { canonicalService: 'Gym Membership', rawMerchant: 'thegym' }))

    // Automatic scan reprocessing must never resurrect the rejected row -
    // unaffected by this test, still covered above. Confirming the candidate,
    // however, is a deliberate explicit user action and must always produce a
    // visible active subscription, even when it reuses that same row.
    const confirmed = await repository.confirmCandidate(user.id, candidate.candidateId)
    assert.equal(confirmed.subscription.id, subscriptionId, 'the same subscription row is reused, not duplicated')
    assert.equal(confirmed.subscription.status, 'active', 'confirming a candidate always yields an active, visible subscription')

    const activeList = await repository.listSubscriptions(user.id)
    assert.equal(activeList.length, 1, 'it now appears in the default listing')
    assert.equal(activeList[0].id, subscriptionId)
    assert.equal(activeList[0].status, 'active')
  })

  testFn(`[${label}] account isolation: another user's repository calls cannot read or mutate this user's subscription or correction`, async () => {
    const repository = await createRepository()
    const userA = await repository.createUser({ email: `${label}-iso-a@example.com`, name: 'Iso A' })
    const userB = await repository.createUser({ email: `${label}-iso-b@example.com`, name: 'Iso B' })
    await repository.authorizeConnection(userA.id)
    const created = await repository.persistParsedEvidence(userA.id, receipt('iso-msg-1'))
    const subscriptionId = created.subscription.id
    await repository.applyCorrection(userA.id, subscriptionId, 'plan', 'Premium')

    assert.equal(await repository.getSubscription(userB.id, subscriptionId), null, 'user B cannot read user A subscription by id')
    assert.equal(await repository.applyCorrection(userB.id, subscriptionId, 'current_price', 999), null, 'user B cannot correct user A subscription')
    assert.equal(await repository.rejectSubscription(userB.id, subscriptionId), null, 'user B cannot reject user A subscription')

    const stillA = await repository.getSubscription(userA.id, subscriptionId)
    assert.equal(stillA.status, 'active', 'user A subscription is unaffected by user B calls')
    assert.equal(stillA.currentPrice, 10, 'user A subscription price is unaffected by user B calls')
    assert.equal(stillA.plan, 'Premium', "user A's own correction is intact")
  })
}

runContractTests('memory', async () => createMemoryRepository())

const connectionString = process.env.DATABASE_URL
let pool
if (connectionString) {
  before(async () => {
    pool = new Pool({ connectionString })
    await pool.query('SELECT 1')
    await pool.query('DROP SCHEMA public CASCADE')
    await pool.query('CREATE SCHEMA public')
    await runMigrations({ pool })
  })
  after(async () => { if (pool) await pool.end() })
}
runContractTests('postgres', async () => createPostgresRepository({ pool }), connectionString ? test : test.skip)
