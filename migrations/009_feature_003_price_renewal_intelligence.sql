-- FEATURE-003: durable, evidence-triggered price-change events. Additive
-- only - no backfill, same as FEATURE-002's migration. Renewal intelligence
-- is deliberately NOT persisted here (see RenewalDerivationService): unlike a
-- price change, "days until renewal" changes every day with no new evidence,
-- so there is nothing to durably "detect once".
CREATE TABLE price_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  previous_evidence_id uuid REFERENCES evidence(id) ON DELETE SET NULL,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency IN ('USD','CAD')),
  previous_price_cents bigint NOT NULL,
  current_price_cents bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('increase','decrease')),
  percent_change_bp integer NOT NULL,
  annualized_delta_cents bigint,
  is_material boolean NOT NULL,
  rule_version text NOT NULL DEFAULT 'v1',
  detected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, evidence_id)
);
CREATE INDEX price_change_events_user_id_idx ON price_change_events(user_id);
CREATE INDEX price_change_events_subscription_id_idx ON price_change_events(subscription_id);
