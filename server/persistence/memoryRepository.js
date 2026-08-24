import { randomUUID } from 'node:crypto'
import { buildAttentionItems } from '../../src/services/attentionItemBuilder.js'
import { detectPriceChangeEvents } from '../../src/services/priceChangeService.js'

const clone = (value) => structuredClone(value)
const publicConnection = (connection) => {
  if (!connection) return null
  const { encryptedRefreshToken, ...safeConnection } = connection
  return clone(safeConnection)
}

// FEATURE-002: the six fields a user may correct, named the same way the
// PostgreSQL `subscription_corrections.field` CHECK constraint names them
// (snake_case, matching the subscriptions column each one corrects) so both
// repositories share one vocabulary for "which field is this".
const CORRECTION_FIELDS = new Set(['canonical_service', 'plan', 'current_price', 'currency', 'billing_cycle', 'next_renewal'])
// Maps a parseReceipt fieldObservations key (camelCase, evidence-facing) to
// the correction field it corresponds to (snake_case, subscriptions-column-facing)
// - used only to detect when freshly scanned evidence conflicts with an
// active user correction on the same underlying subscription field.
const PIPELINE_FIELD_TO_CORRECTION_FIELD = { canonicalService: 'canonical_service', amount: 'current_price', currency: 'currency', cadence: 'billing_cycle', nextRenewal: 'next_renewal' }
const CORRECTION_FIELD_TO_PROPERTY = { canonical_service: 'canonicalService', plan: 'plan', current_price: 'currentPrice', currency: 'currency', billing_cycle: 'billingCycle', next_renewal: 'nextRenewal' }

export const createMemoryRepository = () => {
  const users = new Map([['mock-user', { id: 'mock-user', email: 'demo@example.com', name: 'Demo User' }]])
  const identities = new Map()
  const connections = new Map()
  const subscriptions = new Map()
  const evidence = new Map()
  const billingEvents = new Set()
  const scans = new Map()
  const corrections = new Map()
  const conflicts = new Map()
  const candidates = new Map()
  // FEATURE-003: item_key -> dismissedAt, scoped per user via the key
  // convention `${userId}:${itemKey}` (memoryRepository has no per-user
  // table the way Postgres does, so ownership lives in the key itself).
  const attentionDismissals = new Map()

  const activeCorrectionFor = (subscriptionId, field) => [...corrections.values()].find((item) => item.subscriptionId === subscriptionId && item.field === field && !item.supersededAt)
  const hydrateSub = (sub) => sub && {
    ...sub,
    corrections: [...corrections.values()].filter((item) => item.subscriptionId === sub.id && !item.supersededAt).map((item) => clone(item)),
    conflicts: [...conflicts.values()].filter((item) => { const correction = corrections.get(item.correctionId); return correction && correction.subscriptionId === sub.id && !item.acknowledgedAt }).map((item) => clone({ ...item, field: corrections.get(item.correctionId).field })),
  }

  return {
    createUser: ({ id = randomUUID(), email, name }) => {
      const user = { id, email, name }
      users.set(id, user)
      return clone(user)
    },
    getUser: (id) => clone(users.get(id) || null),
    getIdentityForUser: ({ userId, provider }) => {
      for (const identity of identities.values()) if (identity.userId === userId && identity.provider === provider) return clone({ subject: identity.subject, email: identity.email })
      return null
    },
    resolveOrCreateIdentity: ({ provider, subject, email, name }) => {
      const key = `${provider}:${subject}`
      const existing = identities.get(key)
      if (existing) return clone(users.get(existing.userId))
      const id = randomUUID()
      const user = { id, email, name }
      users.set(id, user)
      identities.set(key, { userId: id, provider, subject, email })
      return clone(user)
    },
    getConnection: (userId) => publicConnection(connections.get(userId) || { status: 'not_connected', scanStatus: 'idle' }),
    authorizeConnection: (userId, encryptedRefreshToken = null) => {
      const connection = { id: connections.get(userId)?.id || randomUUID(), userId, provider: 'gmail', status: 'connected', scanStatus: 'idle', lastScanAt: null, encryptedRefreshToken }
      connections.set(userId, connection)
      return publicConnection(connection)
    },
    getEncryptedRefreshToken: (userId) => connections.get(userId)?.encryptedRefreshToken || null,
    disconnectConnection: (userId) => {
      const connection = connections.get(userId)
      if (!connection) return clone({ status: 'not_connected', scanStatus: 'idle' })
      for (const [id, item] of evidence) if (item.userId === userId) evidence.delete(id)
      for (const [id, item] of subscriptions) if (item.userId === userId) subscriptions.delete(id)
      for (const id of scans.keys()) if (scans.get(id).userId === userId) scans.delete(id)
      connection.status = 'not_connected'
      connection.scanStatus = 'idle'
      connection.encryptedRefreshToken = null
      connections.set(userId, connection)
      return clone(connection)
    },
    beginScan: (userId) => {
      const connection = connections.get(userId)
      if (!connection || connection.status !== 'connected') return null
      if (connection.scanStatus === 'scanning') return { conflict: true }
      const scan = { id: randomUUID(), userId, status: 'scanning', startedAt: new Date().toISOString(), completedAt: null, found: 0 }
      scans.set(scan.id, scan)
      connection.scanStatus = 'scanning'
      connections.set(userId, connection)
      return clone(scan)
    },
    completeScan: (userId, scanId, found, status = 'complete') => {
      const scan = scans.get(scanId)
      const connection = connections.get(userId)
      if (!scan || scan.userId !== userId || !connection) return null
      scan.status = status
      scan.found = found
      scan.completedAt = new Date().toISOString()
      connection.scanStatus = status === 'failed' ? 'error' : 'idle'
      connection.lastScanAt = scan.completedAt
      scans.set(scanId, scan)
      connections.set(userId, connection)
      return clone(scan)
    },
    getScan: (userId, id) => {
      const scan = scans.get(id)
      return clone(scan?.userId === userId ? scan : null)
    },
    upsertMessage: (connectionId, providerMessageId) => `${connectionId}:${providerMessageId}`,
    persistParsedEvidence: (userId, parsed, { failBeforeCommit = false } = {}) => {
      const connection = connections.get(userId)
      if (!connection || connection.status !== 'connected') throw new Error('Connected source required')
      const existing = [...evidence.values()].find((item) => item.userId === userId && item.sourceId === parsed.sourceId)
      if (existing) return { subscription: hydrateSub(clone(subscriptions.get(existing.subscriptionId))), evidence: clone(existing), created: false }
      const evidenceId = randomUUID()
      // Merchant identity is account-scoped and requires both normalized service and
      // raw merchant agreement. Canonical service alone is never enough to merge.
      const candidateSubs = [...subscriptions.values()].filter((item) => item.userId === userId
        && item.canonicalService === parsed.canonicalService
        && item.rawMerchant === parsed.rawMerchant)
      if (candidateSubs.length > 1) return { created: false, ambiguous: true }
      const subscriptionId = candidateSubs[0]?.id || randomUUID()
      const provenance = Object.fromEntries(Object.entries(parsed.fieldObservations || {}).map(([field, observation]) => [field, observation.provenance]))
      const record = { ...parsed, id: evidenceId, userId, subscriptionId, provenance }
      const previous = candidateSubs[0]
      // Tech Lead remediation (GitHub PR #37, BLOCKER 2): each observation
      // carries a stable id (here, the evidence row it came from - a 1:1
      // relationship for a Gmail-derived observation) so
      // detectPriceChangeEvents can key a transition's identity off real
      // source provenance instead of price values alone.
      const observation = { id: evidenceId, amount: parsed.amount, currency: parsed.currency ?? null, observedAt: parsed.receivedAt }
      const billing = { amount: parsed.amount, currency: parsed.currency ?? null, billedAt: parsed.receivedAt, evidenceId }
      const fields = Object.entries(parsed.fieldObservations || {}).map(([field, obs]) => ({ field, value: obs.value ?? null, provenance: obs.provenance, confidence: parsed.confidence.score, evidenceId }))

      // FEATURE-002: an active correction on a field takes precedence over new
      // scan evidence for that field - the subscription column must not be
      // silently overwritten. New evidence/field_observations are still
      // recorded (append-only, unaffected), and a correction_conflicts row is
      // raised instead so the user can later accept or dismiss it.
      const newConflicts = []
      let priceCorrection, currencyCorrection, cadenceCorrection, renewalCorrection
      if (previous) {
        priceCorrection = activeCorrectionFor(previous.id, 'current_price')
        currencyCorrection = activeCorrectionFor(previous.id, 'currency')
        cadenceCorrection = activeCorrectionFor(previous.id, 'billing_cycle')
        renewalCorrection = activeCorrectionFor(previous.id, 'next_renewal')
        for (const [pipelineField, correctionField] of Object.entries(PIPELINE_FIELD_TO_CORRECTION_FIELD)) {
          const obs = parsed.fieldObservations?.[pipelineField]
          if (!obs || obs.value === null || obs.value === undefined) continue
          const correction = activeCorrectionFor(previous.id, correctionField)
          if (!correction) continue
          if (JSON.stringify(obs.value) !== JSON.stringify(correction.value)) {
            newConflicts.push({ id: randomUUID(), correctionId: correction.id, evidenceId, conflictingValue: clone(obs.value), detectedAt: new Date().toISOString(), acknowledgedAt: null })
          }
        }
      }
      // See postgresRepository.js: parseReceipt's currency gate guarantees
      // amount and currency are always jointly null or jointly resolved, so
      // currentPrice and currency are always updated together here too.
      const subscription = previous
        ? {
            ...previous,
            currentPrice: priceCorrection ? previous.currentPrice : (parsed.amount ?? previous.currentPrice),
            currency: currencyCorrection ? previous.currency : (parsed.currency ?? previous.currency),
            billingCycle: cadenceCorrection ? previous.billingCycle : (parsed.cadence || previous.billingCycle),
            nextRenewal: renewalCorrection ? previous.nextRenewal : (parsed.nextRenewal || previous.nextRenewal),
            evidence: [...previous.evidence, record],
            priceHistory: [...previous.priceHistory, observation],
            billingHistory: [...previous.billingHistory, billing],
            fieldObservations: [...previous.fieldObservations, ...fields],
          }
        : { id: subscriptionId, userId, canonicalService: parsed.canonicalService, rawMerchant: parsed.rawMerchant, plan: null, currentPrice: parsed.amount, currency: parsed.currency ?? null, billingCycle: parsed.cadence, nextRenewal: parsed.nextRenewal, status: 'active', source: 'Gmail receipt', evidence: [record], priceHistory: [observation], billingHistory: [billing], fieldObservations: fields }
      if (failBeforeCommit) throw new Error('Simulated transaction failure')
      evidence.set(evidenceId, record)
      subscriptions.set(subscriptionId, subscription)
      billingEvents.add(`${subscriptionId}:${evidenceId}`)
      for (const conflict of newConflicts) conflicts.set(conflict.id, conflict)
      return { subscription: hydrateSub(clone(subscription)), evidence: clone(record), created: true }
    },
    listSubscriptions: (userId) => clone([...subscriptions.values()].filter((item) => item.userId === userId && item.status !== 'rejected')).map(hydrateSub),
    getSubscription: (userId, id) => hydrateSub(clone([...subscriptions.values()].find((item) => item.userId === userId && item.id === id) || null)),

    // FEATURE-002: user-entered corrections, subscription rejection, and
    // ambiguous-candidate review. Ownership is always resolved from the
    // caller-supplied `userId` (the internal UUID derived from the session),
    // never trusted from the record itself.
    applyCorrection: (userId, subscriptionId, field, value) => {
      if (!CORRECTION_FIELDS.has(field)) throw new Error(`Invalid correction field: ${field}`)
      const subscription = [...subscriptions.values()].find((item) => item.userId === userId && item.id === subscriptionId)
      if (!subscription) return null
      const previousActive = activeCorrectionFor(subscriptionId, field)
      if (previousActive) previousActive.supersededAt = new Date().toISOString()
      const correction = { id: randomUUID(), subscriptionId, userId, field, value: clone(value), createdAt: new Date().toISOString(), supersededAt: null }
      corrections.set(correction.id, correction)
      subscription[CORRECTION_FIELD_TO_PROPERTY[field]] = clone(value)
      // A price correction has no receipt behind it, but it still needs to
      // participate in the same observation-pair identity model as every
      // other price change (Tech Lead remediation, GitHub PR #37) rather
      // than needing a second, correction-specific identity scheme.
      if (field === 'current_price') {
        subscription.priceHistory = [...subscription.priceHistory, { id: correction.id, amount: value, currency: subscription.currency, observedAt: correction.createdAt }]
      }
      subscriptions.set(subscriptionId, subscription)
      return { subscription: hydrateSub(clone(subscription)) }
    },
    rejectSubscription: (userId, subscriptionId) => {
      const subscription = [...subscriptions.values()].find((item) => item.userId === userId && item.id === subscriptionId)
      if (!subscription) return null
      subscription.status = 'rejected'
      subscriptions.set(subscriptionId, subscription)
      return hydrateSub(clone(subscription))
    },
    acceptConflict: (userId, conflictId) => {
      const conflict = conflicts.get(conflictId)
      if (!conflict) return null
      const correction = corrections.get(conflict.correctionId)
      if (!correction || correction.userId !== userId) return null
      const previousActive = activeCorrectionFor(correction.subscriptionId, correction.field)
      if (previousActive) previousActive.supersededAt = new Date().toISOString()
      const nextCorrection = { id: randomUUID(), subscriptionId: correction.subscriptionId, userId, field: correction.field, value: clone(conflict.conflictingValue), createdAt: new Date().toISOString(), supersededAt: null }
      corrections.set(nextCorrection.id, nextCorrection)
      const subscription = subscriptions.get(correction.subscriptionId)
      if (subscription) { subscription[CORRECTION_FIELD_TO_PROPERTY[correction.field]] = clone(conflict.conflictingValue); subscriptions.set(subscription.id, subscription) }
      conflict.acknowledgedAt = new Date().toISOString()
      conflicts.set(conflictId, conflict)
      return { subscription: hydrateSub(clone(subscription)) }
    },
    dismissConflict: (userId, conflictId) => {
      const conflict = conflicts.get(conflictId)
      if (!conflict) return null
      const correction = corrections.get(conflict.correctionId)
      if (!correction || correction.userId !== userId) return null
      conflict.acknowledgedAt = new Date().toISOString()
      conflicts.set(conflictId, conflict)
      return clone(conflict)
    },

    // Ambiguous candidates (parseReceipt's `candidate` sketch). A candidate is
    // never counted as an active subscription or spend - it lives entirely in
    // its own table/Map, never as a filtered row of `subscriptions`.
    persistCandidate: (userId, parsed) => {
      const connection = connections.get(userId)
      if (!connection || connection.status !== 'connected') throw new Error('Connected source required')
      const existingEvidence = [...evidence.values()].find((item) => item.userId === userId && item.sourceId === parsed.sourceId)
      if (existingEvidence) return { created: false }
      const evidenceId = randomUUID()
      const record = { id: evidenceId, userId, sourceId: parsed.sourceId, canonicalService: parsed.canonicalService, rawMerchant: parsed.rawMerchant, amount: parsed.amount ?? null, currency: parsed.currency ?? null, cadence: parsed.cadence ?? null, nextRenewal: parsed.nextRenewal ?? null, receivedAt: parsed.receivedAt ?? null, excerpt: parsed.excerpt ?? null, provenance: 'inferred' }
      evidence.set(evidenceId, record)
      const match = [...candidates.values()].find((item) => item.userId === userId && item.canonicalService === parsed.canonicalService && item.rawMerchant === parsed.rawMerchant)
      const candidate = match || { id: randomUUID(), userId, canonicalService: parsed.canonicalService, rawMerchant: parsed.rawMerchant, status: 'pending', resolvedSubscriptionId: null, createdAt: new Date().toISOString(), resolvedAt: null, evidenceIds: [] }
      candidate.evidenceIds = [...candidate.evidenceIds, evidenceId]
      candidates.set(candidate.id, candidate)
      return { created: true, candidateId: candidate.id, evidenceId }
    },
    listCandidates: (userId) => clone([...candidates.values()].filter((item) => item.userId === userId && item.status === 'pending')).map((item) => ({ id: item.id, userId: item.userId, canonicalService: item.canonicalService, rawMerchant: item.rawMerchant, status: item.status, createdAt: item.createdAt, evidence: item.evidenceIds.map((id) => clone(evidence.get(id))).filter(Boolean) })),
    confirmCandidate: (userId, candidateId, overrides = {}) => {
      const candidate = candidates.get(candidateId)
      if (!candidate || candidate.userId !== userId) return null
      if (candidate.status !== 'pending') return { error: 'invalid_state' }
      const evidenceRecords = candidate.evidenceIds.map((id) => evidence.get(id)).filter(Boolean)
      const latest = evidenceRecords.at(-1)
      const existingSubscription = [...subscriptions.values()].find((item) => item.userId === userId && item.canonicalService === candidate.canonicalService && item.rawMerchant === candidate.rawMerchant)
      const subscriptionId = existingSubscription?.id || randomUUID()
      const fields = []
      for (const ev of evidenceRecords) {
        for (const [field, value] of [['canonicalService', ev.canonicalService], ['amount', ev.amount], ['currency', ev.currency], ['cadence', ev.cadence], ['nextRenewal', ev.nextRenewal]]) {
          if (value !== null && value !== undefined) fields.push({ field, value, provenance: 'inferred', confidence: null, evidenceId: ev.id })
        }
      }
      const priceHistoryAdditions = evidenceRecords.map((ev) => ({ id: ev.id, amount: ev.amount, currency: ev.currency, observedAt: ev.receivedAt }))
      const billingHistoryAdditions = evidenceRecords.map((ev) => ({ amount: ev.amount, currency: ev.currency, billedAt: ev.receivedAt, evidenceId: ev.id }))
      const subscription = existingSubscription
        ? {
            ...existingSubscription,
            // Confirming a candidate is a deliberate, explicit user action on
            // a specific candidate they are looking at - unlike automatic
            // scan reprocessing (persistParsedEvidence), which must never
            // resurrect a rejected subscription, this must always produce a
            // visible active subscription, even when it reuses a row that
            // had previously been rejected.
            status: 'active',
            plan: overrides.plan ?? existingSubscription.plan,
            currentPrice: overrides.currentPrice ?? latest?.amount ?? existingSubscription.currentPrice,
            currency: overrides.currency ?? latest?.currency ?? existingSubscription.currency,
            billingCycle: overrides.billingCycle ?? latest?.cadence ?? existingSubscription.billingCycle,
            nextRenewal: overrides.nextRenewal ?? latest?.nextRenewal ?? existingSubscription.nextRenewal,
            evidence: [...existingSubscription.evidence, ...evidenceRecords],
            priceHistory: [...existingSubscription.priceHistory, ...priceHistoryAdditions],
            billingHistory: [...existingSubscription.billingHistory, ...billingHistoryAdditions],
            fieldObservations: [...existingSubscription.fieldObservations, ...fields],
          }
        : {
            id: subscriptionId,
            userId,
            canonicalService: candidate.canonicalService,
            rawMerchant: candidate.rawMerchant,
            plan: overrides.plan ?? null,
            currentPrice: overrides.currentPrice ?? latest?.amount ?? null,
            currency: overrides.currency ?? latest?.currency ?? null,
            billingCycle: overrides.billingCycle ?? latest?.cadence ?? null,
            nextRenewal: overrides.nextRenewal ?? latest?.nextRenewal ?? null,
            status: 'active',
            source: 'Gmail receipt',
            evidence: evidenceRecords,
            priceHistory: priceHistoryAdditions,
            billingHistory: billingHistoryAdditions,
            fieldObservations: fields,
          }
      subscriptions.set(subscriptionId, subscription)
      candidate.status = 'confirmed'
      candidate.resolvedSubscriptionId = subscriptionId
      candidate.resolvedAt = new Date().toISOString()
      candidates.set(candidateId, candidate)
      return { subscription: hydrateSub(clone(subscription)) }
    },
    rejectCandidate: (userId, candidateId) => {
      const candidate = candidates.get(candidateId)
      if (!candidate || candidate.userId !== userId) return null
      if (candidate.status === 'confirmed') return { error: 'invalid_state' }
      candidate.status = 'rejected'
      candidate.resolvedAt = new Date().toISOString()
      candidates.set(candidateId, candidate)
      return { candidate: clone(candidate) }
    },

    // FEATURE-003: price-change/renewal intelligence, mixed with FEATURE-002's
    // existing ambiguous-candidate review into one Worth-your-attention list.
    // Recomputed on every call from current state (subscriptions/
    // priceHistory/candidates), which is naturally idempotent - there's no
    // separate durable event table to accidentally duplicate in the memory
    // backend, unlike Postgres's price_change_events (see postgresRepository.js).
    listAttentionItems: (userId) => {
      const userSubscriptions = [...subscriptions.values()].filter((item) => item.userId === userId && item.status !== 'rejected').map(hydrateSub)
      const userCandidates = [...candidates.values()].filter((item) => item.userId === userId && item.status === 'pending')
      const isDismissed = (itemKey) => attentionDismissals.has(`${userId}:${itemKey}`)
      // Tech Lead remediation (GitHub PR #37, BLOCKER 1): buildAttentionItems
      // no longer detects price changes itself - each subscription's current
      // occurrence (if any) is detected here, from its own priceHistory, the
      // same way postgresRepository.js's recordPriceChangeEvents does (there
      // is no separate durable event table to persist against in-memory, so
      // this recomputes on every call - naturally idempotent, same as the
      // rest of this backend).
      const priceChangeEvents = userSubscriptions.flatMap((subscription) => {
        const latest = detectPriceChangeEvents({ currency: subscription.currency, cadence: subscription.billingCycle, priceHistory: subscription.priceHistory }).at(-1)
        if (!latest) return []
        // Strip the raw observation objects - only the derived eventKey
        // (their identity, not the observations themselves) is part of the
        // attention-item shape, matching what postgresRepository.js's SQL
        // read returns.
        const { previousObservation, currentObservation, ...change } = latest
        return [{ ...change, subscriptionId: subscription.id, eventKey: `${previousObservation.id}:${currentObservation.id}` }]
      })
      return clone(buildAttentionItems({ subscriptions: userSubscriptions, priceChangeEvents, candidates: userCandidates, isDismissed }))
    },
    dismissAttentionItem: (userId, itemKey) => {
      attentionDismissals.set(`${userId}:${itemKey}`, new Date().toISOString())
      return { itemKey, dismissed: true }
    },
  }
}
