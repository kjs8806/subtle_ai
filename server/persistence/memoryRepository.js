import { randomUUID } from 'node:crypto'

const clone = (value) => structuredClone(value)
const publicConnection = (connection) => {
  if (!connection) return null
  const { encryptedRefreshToken, ...safeConnection } = connection
  return clone(safeConnection)
}

export const createMemoryRepository = () => {
  const users = new Map([['mock-user', { id: 'mock-user', email: 'demo@example.com', name: 'Demo User' }]])
  const connections = new Map()
  const subscriptions = new Map()
  const evidence = new Map()
  const billingEvents = new Set()
  const scans = new Map()

  return {
    createUser: ({ id = randomUUID(), email, name }) => {
      const user = { id, email, name }
      users.set(id, user)
      return clone(user)
    },
    getUser: (id) => clone(users.get(id) || null),
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
      if (existing) return { subscription: clone(subscriptions.get(existing.subscriptionId)), evidence: clone(existing), created: false }
      const evidenceId = randomUUID()
      // Merchant identity is account-scoped and requires both normalized service and
      // raw merchant agreement. Canonical service alone is never enough to merge.
      const candidates = [...subscriptions.values()].filter((item) => item.userId === userId
        && item.canonicalService === parsed.canonicalService
        && item.rawMerchant === parsed.rawMerchant)
      if (candidates.length > 1) return { created: false, ambiguous: true }
      const subscriptionId = candidates[0]?.id || randomUUID()
      const provenance = Object.fromEntries(Object.entries(parsed.fieldObservations || {}).map(([field, observation]) => [field, observation.provenance]))
      const record = { ...parsed, id: evidenceId, userId, subscriptionId, provenance }
      const previous = candidates[0]
      const observation = { amount: parsed.amount, observedAt: parsed.receivedAt }
      const billing = { amount: parsed.amount, billedAt: parsed.receivedAt, evidenceId }
      const fields = Object.entries(parsed.fieldObservations || {}).map(([field, observation]) => ({ field, value: observation.value ?? null, provenance: observation.provenance, confidence: parsed.confidence.score, evidenceId }))
      const subscription = previous
        ? { ...previous, currentPrice: parsed.amount ?? previous.currentPrice, billingCycle: parsed.cadence || previous.billingCycle, nextRenewal: parsed.nextRenewal || previous.nextRenewal, evidence: [...previous.evidence, record], priceHistory: [...previous.priceHistory, observation], billingHistory: [...previous.billingHistory, billing], fieldObservations: [...previous.fieldObservations, ...fields] }
        : { id: subscriptionId, userId, canonicalService: parsed.canonicalService, rawMerchant: parsed.rawMerchant, plan: null, currentPrice: parsed.amount, billingCycle: parsed.cadence, nextRenewal: parsed.nextRenewal, status: 'active', source: 'Gmail receipt', evidence: [record], priceHistory: [observation], billingHistory: [billing], fieldObservations: fields }
      if (failBeforeCommit) throw new Error('Simulated transaction failure')
      evidence.set(evidenceId, record)
      subscriptions.set(subscriptionId, subscription)
      billingEvents.add(`${subscriptionId}:${evidenceId}`)
      return { subscription: clone(subscription), evidence: clone(record), created: true }
    },
    listSubscriptions: (userId) => clone([...subscriptions.values()].filter((item) => item.userId === userId)),
    getSubscription: (userId, id) => clone([...subscriptions.values()].find((item) => item.userId === userId && item.id === id) || null),
  }
}
