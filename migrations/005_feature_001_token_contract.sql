ALTER TABLE source_connections
  ALTER COLUMN encrypted_refresh_token TYPE text
  USING CASE WHEN encrypted_refresh_token IS NULL THEN NULL ELSE encode(encrypted_refresh_token, 'base64') END;
ALTER TABLE source_connections ADD COLUMN IF NOT EXISTS token_key_version text;