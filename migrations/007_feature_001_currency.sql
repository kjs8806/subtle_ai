-- FEATURE-001 completion gap: an amount was never persisted with its
-- currency, so "$19.99" was implicitly ambiguous between USD and CAD with no
-- way to tell which. Add an explicit currency column everywhere an amount is
-- stored, restricted to the two currencies FEATURE-001 supports so far.
-- Existing rows have no reliable currency evidence and must not be
-- backfilled to USD or any other value - they stay NULL until a fresh
-- receipt supplies real evidence.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE evidence ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE billing_events ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE price_observations ADD COLUMN IF NOT EXISTS currency text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_currency_check') THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_currency_check CHECK (currency IS NULL OR currency IN ('USD', 'CAD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_currency_check') THEN
    ALTER TABLE evidence ADD CONSTRAINT evidence_currency_check CHECK (currency IS NULL OR currency IN ('USD', 'CAD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_events_currency_check') THEN
    ALTER TABLE billing_events ADD CONSTRAINT billing_events_currency_check CHECK (currency IS NULL OR currency IN ('USD', 'CAD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'price_observations_currency_check') THEN
    ALTER TABLE price_observations ADD CONSTRAINT price_observations_currency_check CHECK (currency IS NULL OR currency IN ('USD', 'CAD'));
  END IF;
END $$;
