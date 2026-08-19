CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL, provider_subject text NOT NULL, email text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE source_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL, authorization_state text NOT NULL DEFAULT 'not_connected', scan_state text NOT NULL DEFAULT 'idle',
  encrypted_refresh_token bytea, last_scan_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
CREATE TABLE scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  status text NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, found_count integer
);
CREATE TABLE source_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  provider_message_id text NOT NULL, received_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_message_id)
);
CREATE TABLE subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_service text NOT NULL, raw_merchant text, plan text, current_price numeric(12,2), billing_cycle text,
  next_renewal date, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_message_id uuid NOT NULL REFERENCES source_messages(id) ON DELETE CASCADE, canonical_service text, raw_merchant text,
  amount numeric(12,2), cadence text, next_renewal date, confidence numeric(5,4), provenance text NOT NULL, excerpt text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE subscription_evidence (
  subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  PRIMARY KEY (subscription_id, evidence_id)
);
CREATE TABLE billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES evidence(id) ON DELETE CASCADE, amount numeric(12,2), billed_at timestamptz,
  UNIQUE (subscription_id, evidence_id)
);
CREATE TABLE price_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  evidence_id uuid REFERENCES evidence(id) ON DELETE SET NULL, amount numeric(12,2), observed_at timestamptz
);
CREATE TABLE field_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subscription_id uuid NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  field text NOT NULL, value jsonb, provenance text NOT NULL CHECK (provenance IN ('confirmed', 'inferred')),
  confidence numeric(5,4), evidence_id uuid REFERENCES evidence(id) ON DELETE SET NULL
);
CREATE INDEX subscriptions_user_id_idx ON subscriptions(user_id);
CREATE INDEX evidence_user_id_idx ON evidence(user_id);
