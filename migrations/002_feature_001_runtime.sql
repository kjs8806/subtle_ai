ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS name text;
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_identity_idx
  ON subscriptions (user_id, canonical_service, COALESCE(raw_merchant, ''));