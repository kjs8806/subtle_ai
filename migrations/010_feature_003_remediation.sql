-- FEATURE-003 remediation (Tech Lead review, GitHub PR #37).
--
-- BLOCKER 1 - price_change_events' identity was two disagreeing models: the
-- table's own `id` (never referenced anywhere - the migration 009 comment
-- claimed dismissals used "price-change:<price_change_events.id>", but the
-- runtime actually built a separately-recomputed composite string
-- "price-change:<subscriptionId>:<previousPrice>:<currentPrice>:<currency>").
-- Fixed here by adding one canonical, persisted `event_key` column that the
-- attention item id and attention_item_dismissals.item_key both reference
-- verbatim - there is no second, independently-derived identity anymore.
--
-- BLOCKER 2 - the old UNIQUE(subscription_id, previous_price, current_price,
-- currency) collapsed genuinely distinct transitions through the same two
-- prices at different points in time (e.g. 10->12 in January and 10->12
-- again in December collided on that key). Fixed by keying occurrence
-- identity off the actual price_observations rows the transition is
-- evidenced by: previous_price_observation_id/current_price_observation_id
-- are real FKs, and event_key is derived from their ids (globally unique per
-- row), so repeated identical transitions at different times never collide
-- while reprocessing the same transition always resolves to the same key.
-- These FKs also give full provenance: price_observations.evidence_id
-- already traces to the receipt (or NULL for a correction-driven
-- observation - see below), so previous/current observation *and* evidence
-- are both traceable from a price_change_events row.
--
-- A FEATURE-002 correction to current_price now also inserts a
-- price_observations row (evidence_id NULL - it has no receipt behind it,
-- and evidence_id was already nullable) instead of only updating
-- subscriptions.current_price directly. That keeps a correction-driven price
-- change inside this exact same observation-pair identity model rather than
-- needing a second, correction-specific identity scheme.
--
-- No backfill: FEATURE-003 has no production data yet (same convention as
-- migration 008), and the old rows carry no observation-pair provenance to
-- backfill from anyway - they are simply dropped and will be idempotently
-- re-derived from price_observations the next time evidence is persisted or
-- a correction is applied for each affected subscription.
DROP TABLE price_change_events;

CREATE TABLE price_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  -- The one canonical, durable identity for this occurrence (BLOCKER 1/2
  -- above): "<previous_price_observation_id>:<current_price_observation_id>".
  -- Referenced verbatim (as "price-change:<event_key>") by the attention
  -- item id and by attention_item_dismissals.item_key.
  event_key text NOT NULL UNIQUE,
  previous_price_observation_id uuid NOT NULL REFERENCES price_observations(id) ON DELETE CASCADE,
  current_price_observation_id uuid NOT NULL REFERENCES price_observations(id) ON DELETE CASCADE,
  change_type text NOT NULL CHECK (change_type IN ('increase','decrease')),
  currency text NOT NULL CHECK (currency IN ('USD','CAD')),
  cadence text NOT NULL CHECK (cadence IN ('monthly','yearly')),
  previous_price numeric(12,2) NOT NULL,
  current_price numeric(12,2) NOT NULL,
  per_period_delta numeric(12,2) NOT NULL,
  percent_change numeric(8,4) NOT NULL,
  annual_impact numeric(12,2) NOT NULL,
  is_attention_worthy boolean NOT NULL,
  first_seen_at timestamptz,
  rule_version integer NOT NULL DEFAULT 1,
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_change_events_user_id_idx ON price_change_events(user_id);
CREATE INDEX price_change_events_subscription_id_idx ON price_change_events(subscription_id);
-- The current, live occurrence for a subscription is "the most recently
-- detected one" - GET /api/v1/attention reads this directly rather than
-- recomputing/upserting on every request (Tech Lead's "recommended
-- architectural cleanup").
CREATE INDEX price_change_events_subscription_detected_idx ON price_change_events(subscription_id, detected_at DESC);
