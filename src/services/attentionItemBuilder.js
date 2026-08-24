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

// Tech Lead remediation (GitHub PR #37, BLOCKER 1): `change.eventKey` is the
// one canonical, durable identity for this occurrence - derived from source
// observation provenance (see detectPriceChangeEvents in
// priceChangeService.js), not from price values. It is exactly what the
// persisted price_change_events row uses as its own identity (event_key
// column) and what attention_item_dismissals.item_key stores, so a
// persisted event, its attention item, and its dismissal always agree.
const priceChangeItem = (subscription, change) => {
  const kind = 'price_change'
  return {
    id: `price-change:${change.eventKey}`,
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
// fieldObservations/corrections, i.e. the same shape listSubscriptions/
// getSubscription already return), pending FEATURE-002 candidates, and the
// already-detected price-change occurrence per subscription (if any -
// `priceChangeEvents`), derives the full Worth-your-attention list.
//
// Tech Lead remediation (GitHub PR #37, "Recommended architectural
// cleanup"): this function no longer computes price-change detection
// itself (that was priceChangeService.detectPriceChange, called with the
// live subscription's priceHistory on every read) - it now only *presents*
// whatever occurrence the caller already detected/persisted. For Postgres,
// that means GET /api/v1/attention reads price_change_events rather than
// recomputing and upserting into it on every request; the actual detection
// and persistence happens where the underlying evidence changes (a new
// Gmail receipt, a FEATURE-002 correction - see postgresRepository.js).
// `priceChangeEvents` is keyed by subscriptionId, one entry each (the
// subscription's current/latest occurrence).
//
// `isDismissed(id)` lets the caller supply persisted per-user dismissal
// state without this function knowing anything about how that's stored.
// `now` is injectable for deterministic testing.
export const buildAttentionItems = ({ subscriptions = [], priceChangeEvents = [], candidates = [], isDismissed = () => false, now = new Date() }) => {
  const items = []
  const priceChangeBySubscriptionId = new Map(priceChangeEvents.map((change) => [change.subscriptionId, change]))
  for (const subscription of subscriptions) {
    const change = priceChangeBySubscriptionId.get(subscription.id)
    if (change?.isAttentionWorthy) items.push(priceChangeItem(subscription, change))

    const certainty = renewalCertaintyFor(subscription, subscription.source)
    const renewal = deriveRenewal({ nextRenewal: subscription.nextRenewal, certainty, now })
    if (renewal.timing !== RENEWAL_TIMING.NONE) items.push(renewalItem(subscription, renewal))
  }
  for (const candidate of candidates) items.push(needsReviewItem(candidate))

  return items.filter((item) => !isDismissed(item.id)).sort((a, b) => a.sortRank - b.sortRank)
}
