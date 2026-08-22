import { findSubscriptionTemplate } from './subscriptionTemplates.js'

// Deterministic, explainable subscription classification. No AI/LLM involved.
// See docs/engineering/SUBSCRIPTION_CLASSIFICATION.md for the design rationale.
//
// Positive signal groups, each contributing its listed points at most once
// regardless of how many of its patterns match.
const POSITIVE_SIGNAL_GROUPS = [
  { reason: 'known_subscription_service', points: 3, template: true },
  { reason: 'explicit_subscription', points: 3, patterns: [/\bsubscriptions?\b/i] },
  { reason: 'explicit_membership', points: 3, patterns: [/\bmemberships?\b/i] },
  { reason: 'recurring_language', points: 3, patterns: [/\brecurring\b/i, /\brenews?\b/i, /\brenewal\b/i, /\brenewed\b/i, /auto[-\s]?renew(s|ed|al)?/i, /trial\s+(converts?|renews?)/i] },
  { reason: 'explicit_cadence', points: 2, patterns: [/\bmonthly\b/i, /per\s+month/i, /\/\s*mo(nth)?\b/i, /\byearly\b/i, /\bannual(ly)?\b/i, /per\s+year/i, /\/\s*y(ea)?r\b/i, /charged\s+every\s+month/i, /charged\s+annually/i] },
  { reason: 'next_billing_date', points: 2, patterns: [/next\s+billing/i, /next\s+payment/i, /next\s+renewal/i, /billing\s+(date|cycle|period)/i] },
]

// Negative signal groups: strong indicators the message is a one-time
// transaction. Each is worth -5, deliberately uniform (the brief allows -4 or
// -5 "strong one-time" and -5 "known transactional template" separately, but
// a single consistent weight keeps the model simpler and every example in
// the brief still classifies correctly at this weight - see the doc note).
const NEGATIVE_SIGNAL_GROUPS = [
  { reason: 'ride_receipt', points: -5, patterns: [/\btrip\s+fare\b/i, /\bride\s+receipt\b/i, /\bpickup\b/i, /\bdrop.?off\b/i, /riding\s+with\s+(uber|lyft)/i, /\b(uber|lyft)\s+ride\b/i] },
  { reason: 'delivery_order', points: -5, patterns: [/order\s+(has\s+been\s+)?delivered/i, /delivery\s+order/i, /restaurant\s+order/i, /food\s+order/i, /\buber\s*eats\b/i, /\bdoordash\b/i] },
  { reason: 'travel_booking', points: -5, patterns: [/flight\s+(confirmation|booking)/i, /\bitinerary\b/i, /hotel\s+(stay|reservation)/i, /reservation\s+confirm/i, /booking\s+confirmation/i, /\bticket\b/i] },
  { reason: 'retail_purchase', points: -5, patterns: [/order\s+number/i, /order\s*#/i, /\bshipped\b/i, /item\s+purchased/i, /purchase\s+receipt/i, /order\s+receipt/i, /store\s+order/i, /thank\s+you\s+for\s+your\s+purchase/i] },
]

// classifySubscriptionCandidate scores a candidate email deterministically.
// Thresholds:
//   score >= 5            -> subscription
//   score <= 1 AND has a
//     negative signal      -> one_time (we have explicit one-time evidence)
//   otherwise              -> ambiguous (score 2-4, or score <= 1 with no
//                              evidence either way - a generic receipt/
//                              invoice/payment gives us nothing to decide on)
//
// This naturally enforces the brief's "known service alone is not enough"
// and "unknown merchant needs >= 2 signals" rules: a template match alone is
// worth 3 points (below 5), and any single positive-signal group tops out at
// 3 points too, so a single signal never crosses the threshold on its own.
export const classifySubscriptionCandidate = ({ subject = '', sender = '', body = '' }) => {
  const rawText = `${subject}\n${sender}\n${body}`
  let score = 0
  const reasons = []
  const negativeReasons = []

  const template = findSubscriptionTemplate(rawText, sender)
  const canonicalService = template?.canonicalService || null
  const category = template?.category || null
  if (template) { score += 3; reasons.push('known_subscription_service') }

  for (const group of POSITIVE_SIGNAL_GROUPS) {
    if (group.template) continue
    if (group.patterns.some((pattern) => pattern.test(rawText))) { score += group.points; reasons.push(group.reason) }
  }

  for (const group of NEGATIVE_SIGNAL_GROUPS) {
    if (group.patterns.some((pattern) => pattern.test(rawText))) { score += group.points; negativeReasons.push(group.reason) }
  }

  let classification
  if (score >= 5) classification = 'subscription'
  else if (score <= 1 && negativeReasons.length > 0) classification = 'one_time'
  else classification = 'ambiguous'

  return { classification, score, canonicalService, category, reasons, negativeReasons }
}
