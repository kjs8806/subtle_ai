# Subscription classification

FEATURE-001's Gmail receipt pipeline distinguishes recurring subscriptions
from one-time purchases before any evidence is persisted. Classification
happens in `src/services/subscriptionClassifier.js` and
`src/services/subscriptionTemplates.js`, and is called from
`src/services/receiptPipeline.js#parseReceipt` before evidence extraction.

## Principles

- **Known service templates are confidence signals, not an allow-list.**
  Matching a template (`src/services/subscriptionTemplates.js`) is worth 3
  points - well below the 5-point subscription threshold on its own. A
  template match must combine with at least one recurrence signal from the
  email itself to qualify.
- **Generic receipt/invoice/payment language is not sufficient evidence.**
  Those words only gate whether an email enters the classifier at all; they
  contribute zero score. A bare "payment receipt" with nothing else is
  `ambiguous`, never `subscription`.
- **One-time transaction language suppresses false positives.** Ride,
  delivery, travel, and retail phrasing (`NEGATIVE_SIGNAL_GROUPS`) pulls the
  score sharply negative, overriding any weak positive signal.
- **Unknown/local services can still qualify** through strong recurrence
  evidence alone - the scoring model has no dependency on the template
  catalog. Two or more recurrence signals (e.g. "membership" + "renews" +
  "monthly") clear the threshold without any known-service match.
- **Classification is deterministic for FEATURE-001.** No AI/LLM model is
  involved; every decision traces back to an explicit, testable pattern
  match. AI/ML-based classification remains explicitly out of scope for this
  phase.

## Multi-product companies

Google, Apple, Amazon, Microsoft, and Uber sell both one-time and recurring
products from the same sending domain. Their subscription templates
(`Google One`, `iCloud+`, `Amazon Prime`, `Microsoft 365`, `Uber One`)
deliberately omit `senderPatterns` - matching the sending domain alone (e.g.
any `@amazon.com` email) is not a safe signal for these companies. Only
content that names the specific recurring product counts as a template
match. A generic Amazon shipping notice or Google Play purchase receipt
never receives `known_subscription_service` credit, regardless of sender.

Single-purpose services (Netflix, Spotify, Dropbox, Adobe, Canva, NordVPN,
ExpressVPN, Disney+, Hulu, Max) have no meaningful one-time product line, so
their templates match on sender domain OR message content.

## Scoring model

| Signal | Points |
|---|---|
| Known subscription template match | +3 |
| Explicit "subscription" | +3 |
| Explicit "membership" | +3 |
| Renewal / recurring / auto-renew | +3 |
| Explicit monthly/yearly cadence | +2 |
| Next billing / next renewal date | +2 |
| Generic receipt/invoice/payment | 0 |
| One-time transaction signal (ride, delivery, travel, retail) | -5 |

Thresholds:

- `score >= 5` -> `subscription`
- `score <= 1` **and** at least one negative signal fired -> `one_time`
- otherwise (score 2-4, or score <= 1 with no signal either way) -> `ambiguous`

The middle case is deliberate: a message that gates in as receipt-like but
carries no evidence either way (a truly generic "payment received" email
from an unrecognized sender) is something we genuinely don't know about, not
something we've confirmed is a one-time purchase. `ambiguous` is never
auto-imported; it's surfaced to the scan-result `ambiguous` count instead.

All one-time signal categories are weighted uniformly at -5 rather than
distinguishing "-4 strong indicator" from "-5 known transactional template" -
every worked example in the classification brief still lands correctly at
this single weight, and a uniform weight keeps the model simpler to reason
about and test.

## Persistence behavior

`server/app.js`'s scan loop only calls `repository.persistParsedEvidence`
when `parseReceipt` returns `classification: 'subscription'`. `one_time` and
`not_receipt` messages are skipped silently; `ambiguous` messages increment
the scan result's `ambiguous` counter but are never persisted. A one-time
receipt never creates a subscription, evidence row, billing event, price
observation, or field observation.

## Known limitations

- The scoring weights were chosen to satisfy every worked example in the
  classification brief, not tuned against a large real-world receipt corpus.
  Real inboxes will surface phrasing this model doesn't yet recognize.
- A subscription service that sends receipts with unusually terse language
  (no explicit "renews"/"monthly"/"membership" wording) may score as
  `ambiguous` and require manual entry instead of auto-import - this is
  intentional conservatism, not a bug.
- The template catalog covers well-known consumer subscription services; it
  is not exhaustive and is expected to grow over time.
