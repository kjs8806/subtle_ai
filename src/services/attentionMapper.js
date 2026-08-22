// Maps a GET /api/v1/subscriptions/attention item into the action-card shape
// src/ui/overview.js's actionCard() expects: { id, label, affectedServices,
// body, saving?, impactLabel? }. Kept as a pure function, separate from
// src/main.js's DOM wiring, the same way subscriptionMapper.js is.
//
// Product decision (FEATURE-003 #4): currency must remain visible wherever
// omission could make an amount ambiguous, and USD/CAD amounts are never
// combined or compared as equivalent. The attention feed can mix
// differently-currencied subscriptions in one list, so every amount here is
// labelled with its currency explicitly (e.g. "CAD 22.99"/"USD 22.99")
// rather than a bare, currency-neutral "$".
const formatMoney = (value, currency) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const amount = value.toFixed(2)
  if (currency === 'CAD') return `CAD ${amount}`
  if (currency === 'USD') return `USD ${amount}`
  return `$${amount}` // currency unknown - never fabricate USD/CAD
}
const perPeriodSuffix = (cadence) => (cadence === 'yearly' ? '/year' : cadence === 'monthly' ? '/month' : '')

const toPriceIncreaseAction = (item) => {
  const previous = formatMoney(item.previousPrice, item.currency)
  const current = formatMoney(item.currentPrice, item.currency)
  const perPeriodIncrease = formatMoney(item.perPeriodIncrease, item.currency)
  const period = perPeriodSuffix(item.cadence)
  const annualized = formatMoney(item.annualizedIncrease, item.currency)
  const bodyParts = []
  if (previous && current) bodyParts.push(`${previous} → ${current}${period}`)
  if (perPeriodIncrease) bodyParts.push(`+${perPeriodIncrease}${period}`)
  if (annualized && !period) bodyParts.push(`+${annualized}/year`) // unknown cadence: still surface the annualized figure if calculable
  return {
    id: item.subscriptionId,
    label: `${item.canonicalService} increased in price`,
    affectedServices: [item.canonicalService],
    body: bodyParts.join(' · ') || 'Price increased since the last receipt.',
    saving: annualized ? `+${annualized}/year` : undefined,
    impactLabel: annualized ? 'Additional yearly cost' : undefined,
  }
}

// renewalDate is a plain 'YYYY-MM-DD' string (see RenewalDerivationService) -
// days-until is derived client-side from it rather than carried over the
// wire, since it changes with every passing day regardless of new evidence.
const daysUntil = (isoDate) => {
  if (typeof isoDate !== 'string') return null
  const target = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(target.getTime())) return null
  const now = new Date()
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - todayUTC) / 86400000)
}

const renewalTiming = (item) => {
  const days = daysUntil(item.renewalDate)
  if (item.bucket === 'due_today' || days === 0) return 'renews today'
  if (days === 1) return 'renews tomorrow'
  if (typeof days === 'number' && days > 1) return `renews in ${days} days`
  return 'renews soon' // never an alarmist label like "Urgent"
}

const toRenewalAction = (item) => {
  const amount = formatMoney(item.amount, item.currency)
  const period = perPeriodSuffix(item.cadence)
  // Confirmed renewals are stated as fact; inferred ones are always labelled
  // "Expected", never presented as certain (Product decision #2).
  const certaintyLabel = item.certainty === 'confirmed' ? 'Confirmed renewal' : 'Expected renewal'
  const bodyParts = []
  if (amount) bodyParts.push(`${amount}${period}`)
  bodyParts.push(certaintyLabel)
  return {
    id: item.subscriptionId,
    label: `${item.canonicalService} ${renewalTiming(item)}`,
    affectedServices: [item.canonicalService],
    body: bodyParts.join(' · '),
  }
}

export const toAttentionAction = (item) => (item.type === 'price_increase' ? toPriceIncreaseAction(item) : toRenewalAction(item))
