-- MVP-BETA-007 (#44) production incident: sign-in and Gmail-connect OAuth
-- state was held in an in-process Map (server/app.js), which only works
-- when exactly one process ever handles both legs of the OAuth round trip.
-- Cloud Run is multi-instance and scale-to-zero - the callback request can
-- land on a different instance (or a freshly cold-started one) than the
-- one that issued the state, which made every real sign-in fail with
-- auth_error=invalid_oauth_state. This table makes OAuth state durable and
-- shared across instances, the same way `sessions` (migration 001) already
-- is for session tokens.
CREATE TABLE oauth_states (
  state text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  purpose text
);
