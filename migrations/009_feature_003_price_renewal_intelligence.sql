-- FEATURE-003: durable price-change intelligence and generic attention-item
-- dismissal, per Tech Lead guidance (GitHub issue #22) - derived
-- intelligence is persisted rather than recalculated ad hoc, keyed so
-- rescans/reprocessing never create duplicate active events. Additive only.

-- One row per distinct (subscription, previous price -> current price,
-- currency) transition ever detected - "record every confirmed price
-- change" (Product Owner decision #1). is_attention_worthy is the
-- >=5%-or->=$24/year materiality gate; a confirmed decrease is still
-- recorded (price history) but is_attention_worthy is always false for one.
-- The unique constraint is the idempotency key: reprocessing the same
-- evidence/rescan re-detects the identical transition and upserts rather
-- than duplicating it. (A subscription's price oscillating back to an exact
-- prior value later would collapse into the same row rather than a fresh
-- one - accepted as a rare edge case for subscription pricing.)
CREATE TABLE price_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
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
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, previous_price, current_price, currency)
);
CREATE INDEX price_change_events_user_id_idx ON price_change_events(user_id);
CREATE INDEX price_change_events_subscription_id_idx ON price_change_events(subscription_id);

-- Generic per-user dismissal for any Worth-your-attention item (a price
-- increase event or a renewal reminder alike), keyed by a stable synthetic
-- item_key rather than a foreign key to either source table, since a
-- renewal reminder has no discrete "event" row of its own (it's a
-- continuously-current derived view of the subscription's renewal date, not
-- a thing that "happened" the way a price change is). item_key convention:
--   price-change:<price_change_events.id>
--   renewal:<subscription_id>:<next_renewal_date>
-- Including the renewal date in its key means dismissing one upcoming
-- renewal does not silently suppress the next cycle's reminder too.
CREATE TABLE attention_item_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, item_key)
);
