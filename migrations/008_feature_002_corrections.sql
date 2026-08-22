-- FEATURE-002: user corrections, subscription rejection, and ambiguous
-- candidate review. Additive only - no backfill, since there is no real
-- production data yet for this repo.

ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check CHECK (status IN ('active','rejected'));

ALTER TABLE field_observations DROP CONSTRAINT field_observations_provenance_check;
ALTER TABLE field_observations ADD CONSTRAINT field_observations_provenance_check
  CHECK (provenance IN ('confirmed','inferred','user_confirmed'));

CREATE TABLE subscription_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field text NOT NULL CHECK (field IN ('canonical_service','plan','current_price','currency','billing_cycle','next_renewal')),
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX one_active_correction_per_field
  ON subscription_corrections(subscription_id, field) WHERE superseded_at IS NULL;

CREATE TABLE correction_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correction_id uuid NOT NULL REFERENCES subscription_corrections(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  conflicting_value jsonb NOT NULL,
  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);

CREATE TABLE subscription_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_service text NOT NULL,
  raw_merchant text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  resolved_subscription_id uuid REFERENCES subscriptions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (user_id, canonical_service, raw_merchant)
);
CREATE TABLE candidate_evidence (
  candidate_id uuid NOT NULL REFERENCES subscription_candidates(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (candidate_id, evidence_id)
);
