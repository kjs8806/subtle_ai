# FEATURE-001 currency

FEATURE-001 captures and persists a currency alongside every amount it
extracts from a Gmail receipt. This closes a completion gap: a bare `$19.99`
was previously stored as `amount: 19.99` with no way to tell whether that
meant USD or CAD.

## Supported currencies

- USD
- CAD

No other currency is treated as a valid stored value. This is not an
allow-list gap to be expanded casually - it's the explicit scope boundary for
this phase of FEATURE-001.

## Explicit rules

- **Bare `$` is ambiguous.** `$19.99` alone never resolves to USD or CAD -
  currency stays `null`. The symbol is shared by both supported currencies
  and by many others; it carries no currency information on its own.
- **Unknown currency stays NULL**, never USD. Nothing in the pipeline ever
  defaults to USD as a fallback.
- **No default USD.** This applies everywhere: extraction, persistence,
  merging, and the frontend. A `null` currency is never displayed or stored
  as if it were USD.
- **Unsupported currencies (EUR, GBP, ...) are not automatically accepted.**
  A receipt tagged with a currency FEATURE-001 doesn't support is treated the
  same as an unresolved bare-`$` amount: the amount is recognized (so it
  doesn't silently fall through as "no amount found"), but currency stays
  `null` and the receipt is not auto-created as a fully confirmed
  subscription.
- **Currency conversion is not implemented.** Price-change detection never
  compares amounts across different or unknown currencies as an increase -
  see below.
- **FEATURE-002 can correct persisted currency later**, the same way it can
  correct price or cadence. This phase only makes sure a real currency field
  exists underneath that future correction flow.

## Extraction

`src/services/receiptPipeline.js#extractAmountAndCurrency` extracts amount
and currency independently, from separate patterns - amount is never used to
infer currency, and vice versa.

Recognized currency markers:

| Currency | Recognized forms |
|---|---|
| USD | `USD 19.99`, `USD $19.99`, `US$19.99`, `$19.99 USD` |
| CAD | `CAD 19.99`, `CAD $19.99`, `CA$19.99`, `C$19.99`, `$19.99 CAD` |
| unknown | `$19.99`, `Total $22.99`, any bare `$` amount |

If both a USD and a CAD indicator appear in the same message (a coincidental
mention of both), currency resolves to `null` rather than guessing between
them - exactly as unresolved as seeing neither.

## Auto-creation gating

Currency is part of FEATURE-001's minimum evidence for automatic creation,
alongside subscription classification (see
[SUBSCRIPTION_CLASSIFICATION.md](SUBSCRIPTION_CLASSIFICATION.md)) and amount.
`parseReceipt` classifies a candidate email as `subscription` first (based on
recurrence language), then separately extracts amount and currency. If an
amount was found but currency could not be resolved to USD or CAD, the
result is downgraded to `ambiguous` - the same non-persisted,
counted-in-the-scan's-`ambiguous`-total path already used for weak
recurrence signals. The evidence is never partially persisted with a
fabricated currency.

A message with no amount at all (currency trivially unresolved too) is
unaffected by this gate - that's the pre-existing "amount unknown" behavior,
unchanged by this work.

## Schema

`migrations/007_feature_001_currency.sql` adds a nullable `currency text`
column to `subscriptions`, `evidence`, `billing_events`, and
`price_observations`, each with a `CHECK (currency IS NULL OR currency IN
('USD', 'CAD'))` constraint enforced by the database itself, not just the
application layer. Existing rows are left `NULL` - never backfilled to USD
or any other value, since there is no reliable evidence for what currency
they were in.

## Price-change and merge behavior

`detectPriceChange` only reports a price increase when both compared price
observations share the same *resolved* currency. A currency mismatch, or
either observation having an unresolved currency, means no price-change
recommendation is generated - `$10 USD` to `$12 CAD` is never reported as a
$2 increase, and currency conversion is out of scope.

`mergeSubscriptionDetections` and the repository-level upsert in
`persistParsedEvidence` never overwrite or compare amounts across
currencies as equivalent. Each individual evidence, price observation, and
billing event keeps its own original currency. A subscription's headline
`currentPrice`/`currency` pair always reflects its most recent evidence
together, so the two can never drift out of sync with each other - but
historical entries retain whatever currency they were actually observed in.
