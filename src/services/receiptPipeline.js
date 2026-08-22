const MERCHANT_RULES = [
  { pattern: /netflix/i, canonicalService: 'Netflix', category: 'Entertainment' },
  { pattern: /dropbox/i, canonicalService: 'Dropbox', category: 'Cloud storage' },
  { pattern: /google\s*(one|storage)|google\s*\*/i, canonicalService: 'Google One', category: 'Cloud storage' },
  { pattern: /adobe/i, canonicalService: 'Adobe', category: 'Work tools' },
  { pattern: /canva/i, canonicalService: 'Canva', category: 'Work tools' },
  { pattern: /spotify/i, canonicalService: 'Spotify', category: 'Entertainment' },
  { pattern: /nordvpn/i, canonicalService: 'NordVPN', category: 'Security' },
]

const OVERLAP_PAIRS = new Set([
  ['Dropbox', 'Google One'].sort().join('|'),
])

const RECEIPT_TERMS = /receipt|renewal|renewed|membership|invoice|subscription|trial|payment/i
const CURRENCY_PATTERN = /(?:USD|US\$|\$)\s?([0-9]+(?:\.[0-9]{2})?)/i
const CADENCE_PATTERN = /(monthly|per month|\/month|annual|yearly|per year|\/year)/i
const DATE_PATTERN = /(?:next billing|renews?|renewal|billing date|due)[^\n]{0,20}?([A-Z][a-z]+\s+\d{1,2}(?:,\s*\d{4})?)/i

const confidenceFor = ({ merchant, amount, cadence, nextRenewal }) => {
  const signals = [merchant, amount, cadence, nextRenewal].filter(Boolean).length
  if (signals >= 4) return { score: 0.96, state: 'confirmed' }
  if (signals >= 2) return { score: 0.74, state: 'inferred' }
  return { score: 0.42, state: 'inferred' }
}

export const createEvidence = (data) => ({
  id: data.id,
  type: data.type,
  sourceId: data.sourceId,
  sourceLabel: data.sourceLabel,
  rawMerchant: data.rawMerchant,
  canonicalService: data.canonicalService,
  amount: data.amount,
  cadence: data.cadence,
  nextRenewal: data.nextRenewal,
  receivedAt: data.receivedAt,
  confidence: data.confidence,
  excerpt: data.excerpt,
  fieldObservations: data.fieldObservations || {},
})

export const createPriceObservation = ({ amount, observedAt }) => ({ amount, observedAt })

export const createBillingEvent = ({ amount, billedAt }) => ({ amount, billedAt })

export const createRecommendationEvidence = (evidenceIds = []) => evidenceIds.map((evidenceId) => ({ evidenceId }))

export const createRecommendation = (data) => ({
  ...data,
  evidenceIds: data.evidenceIds || [],
  evidence: createRecommendationEvidence(data.evidenceIds),
})

export const createSubscription = (data) => ({
  ...data,
  evidence: data.evidence || [],
  priceHistory: data.priceHistory || [],
  billingHistory: data.billingHistory || [],
  recommendations: data.recommendations || [],
})

export const normalizeMerchant = (rawMerchant = '') => {
  const rule = MERCHANT_RULES.find(({ pattern }) => pattern.test(rawMerchant))
  return rule || { canonicalService: rawMerchant.trim() || 'Unknown service', category: 'Other' }
}

export const parseReceipt = ({ id, subject = '', sender = '', receivedAt, body = '' }) => {
  const rawText = `${subject}\n${sender}\n${body}`
  if (!RECEIPT_TERMS.test(rawText)) return null

  const merchantMatch = MERCHANT_RULES.find(({ pattern }) => pattern.test(rawText))
  const merchant = merchantMatch?.canonicalService || sender.split('@')[0] || 'Unknown service'
  const amountMatch = rawText.match(CURRENCY_PATTERN)
  const amount = amountMatch ? Number(amountMatch[1]) : null
  const cadenceMatch = rawText.match(CADENCE_PATTERN)?.[1]?.toLowerCase()
  const cadence = cadenceMatch?.includes('year') || cadenceMatch === 'annual' ? 'yearly' : cadenceMatch ? 'monthly' : null
  const nextRenewal = rawText.match(DATE_PATTERN)?.[1] || null
  const confidence = confidenceFor({ merchant: merchantMatch, amount, cadence, nextRenewal })
  const fieldObservations = {
    canonicalService: { value: merchant, provenance: merchantMatch ? 'confirmed' : 'inferred' },
    amount: { value: amount, provenance: amount === null ? 'inferred' : 'confirmed' },
    cadence: { value: cadence, provenance: cadence ? 'confirmed' : 'inferred' },
    nextRenewal: { value: nextRenewal, provenance: nextRenewal ? 'confirmed' : 'inferred' },
  }

  return createEvidence({
    id: `evidence-${id}`,
    type: 'gmail_receipt',
    sourceId: id,
    sourceLabel: 'Gmail receipt',
    rawMerchant: sender.split('@')[0] || merchant,
    canonicalService: merchant,
    amount,
    cadence,
    nextRenewal,
    receivedAt: receivedAt || null,
    confidence,
    fieldObservations,
    excerpt: subject,
  })
}

export const createSubscriptionRecord = (evidence, overrides = {}) => {
  if (!evidence) return null
  const normalized = normalizeMerchant(evidence.canonicalService || evidence.rawMerchant)
  return createSubscription({
    id: overrides.id || evidence.canonicalService.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    canonicalService: normalized.canonicalService,
    rawMerchant: evidence.rawMerchant,
    plan: overrides.plan || 'Unknown plan',
    currentPrice: overrides.currentPrice ?? evidence.amount,
    billingCycle: overrides.billingCycle || evidence.cadence || 'unknown',
    nextRenewal: overrides.nextRenewal || evidence.nextRenewal,
    status: overrides.status || 'active',
    confidence: overrides.confidence || evidence.confidence,
    source: evidence.sourceLabel,
    evidence: [evidence],
    priceHistory: overrides.priceHistory || [createPriceObservation({ amount: evidence.amount, observedAt: evidence.receivedAt })],
    billingHistory: overrides.billingHistory || [createBillingEvent({ amount: evidence.amount, billedAt: evidence.receivedAt })],
    recommendations: overrides.recommendations || [],
    category: overrides.category || normalized.category,
  })
}

export const detectPriceChange = (priceHistory = []) => {
  if (priceHistory.length < 2) return null
  const previous = priceHistory[priceHistory.length - 2].amount
  const current = priceHistory[priceHistory.length - 1].amount
  if (!previous || current <= previous) return null
  return { type: 'price_increase', previous, current, annualImpact: (current - previous) * 12, reason: 'The same subscription was observed at a higher price in a later receipt.' }
}

export const buildRecommendations = (record, relatedRecords = []) => {
  const recommendations = []
  const priceChange = detectPriceChange(record.priceHistory)
  if (priceChange) recommendations.push(createRecommendation({ type: 'price_increase', priority: 'medium', ...priceChange, evidenceIds: record.evidence.map(({ id }) => id) }))
  const overlap = relatedRecords.find((related) => {
    const pair = [record.canonicalService, related.canonicalService].sort().join('|')
    return related.id !== record.id && OVERLAP_PAIRS.has(pair)
  })
  if (overlap) recommendations.push(createRecommendation({ type: 'possible_overlap', priority: 'high', relatedSubscriptionId: overlap.id, reason: `Both ${record.canonicalService} and ${overlap.canonicalService} provide ${record.category.toLowerCase()} services.`, evidenceIds: [...record.evidence, ...overlap.evidence].map(({ id }) => id) }))
  return recommendations
}

export const mergeSubscriptionDetections = (records = []) => {
  const merged = new Map()
  records.forEach((record) => {
    const existing = merged.get(record.canonicalService)
    if (!existing) {
      merged.set(record.canonicalService, { ...record })
      return
    }
    existing.evidence = [...existing.evidence, ...record.evidence]
    existing.priceHistory = [...existing.priceHistory, ...record.priceHistory].sort((a, b) => String(a.observedAt).localeCompare(String(b.observedAt)))
    existing.billingHistory = [...existing.billingHistory, ...record.billingHistory]
    existing.currentPrice = existing.priceHistory.at(-1)?.amount || existing.currentPrice
    existing.confidence = existing.evidence.some((item) => item.confidence.state === 'confirmed') ? { score: 0.98, state: 'confirmed' } : existing.confidence
  })
  return [...merged.values()]
}
