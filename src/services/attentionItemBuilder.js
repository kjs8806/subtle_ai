import { detectPriceChange } from './priceChangeService.js'
import { deriveRenewal, renewalCertaintyFor, RENEWAL_TIMING } from './renewalDerivationService.js'

// FEATURE-003 rule version, persisted on every derived price-change fact so
// a future rule change can be told apart from data produced under the old
// one (Tech Lead guidance: "rule/version" on every derived item).
export const RULE_VERSION = 1

// Product Owner's approved priority order (GitHub issue #22, decision #3):
// 1. renewal within 7 days = higher attention, 2. material price increase =
// attention, 3. renewal 8-30 days = normal attention. Needs-review
// candidates (unconfirmed, lowest stakes) sort last. This governs list sort
// order; the High/Medium/Low visual badge tier is a related but distinct
// judgment call - see priorityFor below.
const SORT_RANK = { renewal_soon: 0, price_change: 1, renewal_upcoming: 2, needs_review: 3 }

// Maps a candidate item to a High/Medium/Low severity tier. The mockup badges
// don't map 1:1 onto the written Product Owner priority order (it shows a
// price increase as HIGH and a 6-day renewal as MEDIUM, which the Product
// Owner's own follow-up comment says not to treat as authoritative -
// "labels such as High/Medium/Low are visual aids, not authorization for a
// new generalized scoring engine"). This applies genuine urgency semantics
// instead: an imminent renewal is the one thing with a hard deadline, so it
// reads High; a material price increase is worth acting on but isn't
// time-boxed, so Medium; a renewal that's still 8-30 days out or an
// unconfirmed candidate are Low.
const priorityFor = (kind) => {
  if (kind === 'renewal_soon') return 'high'
  if (kind === 'price_change') return 'medium'
  return 'low'
}

const priceChangeItem = (subscription, change) => {
  const kind = 'price_change'
  return {
    // Stable per (subscription, transition) - matches
    // price_change_events(subscription_id, previous_price, current_price,
    // currency)'s unique key, so this id is also usable as the durable
    // event's natural key and as an attention_item_dismissals item_key.
    id: `price-change:${subscription.id}:${change.previousPrice}:${change.currentPrice}:${change.currency}`,
    type: 'price_change',
    subscriptionId: subscription.id,
    canonicalService: subscription.canonicalService,
    plan: subscription.plan,
    priority: priorityFor(kind),
    sortRank: SORT_RANK[kind],
    ruleVersion: RULE_VERSION,
    priceChange: change,
  }
}

const renewalItem = (subscription, renewal) => {
  const kind = renewal.timing === RENEWAL_TIMING.UPCOMING ? 'renewal_upcoming' : 'renewal_soon'
  return {
    id: `renewal:${subscription.id}:${renewal.date}`,
    type: 'renewal',
    subscriptionId: subscription.id,
    canonicalService: subscription.canonicalService,
    plan: subscription.plan,
    priority: priorityFor(kind),
    sortRank: SORT_RANK[kind],
    ruleVersion: RULE_VERSION,
    renewal,
  }
}

const needsReviewItem = (candidate) => ({
  id: `needs-review:${candidate.id}`,
  type: 'needs_review',
  subscriptionId: null,
  candidateId: candidate.id,
  canonicalService: candidate.canonicalService,
  plan: null,
  priority: priorityFor('needs_review'),
  sortRank: SORT_RANK.needs_review,
  ruleVersion: RULE_VERSION,
})

// Pure orchestration: given already-hydrated subscriptions (each carrying
// priceHistory/fieldObservations/corrections, i.e. the same shape
// listSubscriptions/getSubscription already return) and pending FEATURE-002
// candidates, derives the full Worth-your-attention list. `isDismissed(id)`
// lets the caller (a repository) supply persisted per-user dismissal state
// without this function knowing anything about how that's stored.
// `now` is injectable for deterministic testing.
export const buildAttentionItems = ({ subscriptions = [], candidates = [], isDismissed = () => false, now = new Date() }) => {
  const items = []
  for (const subscription of subscriptions) {
    const change = detectPriceChange({ currentPrice: subscription.currentPrice, currency: subscription.currency, cadence: subscription.billingCycle, priceHistory: subscription.priceHistory || [] })
    if (change?.isAttentionWorthy) items.push(priceChangeItem(subscription, change))

    const certainty = renewalCertaintyFor(subscription, subscription.source)
    const renewal = deriveRenewal({ nextRenewal: subscription.nextRenewal, certainty, now })
    if (renewal.timing !== RENEWAL_TIMING.NONE) items.push(renewalItem(subscription, renewal))
  }
  for (const candidate of candidates) items.push(needsReviewItem(candidate))

  return items.filter((item) => !isDismissed(item.id)).sort((a, b) => a.sortRank - b.sortRank)
}
