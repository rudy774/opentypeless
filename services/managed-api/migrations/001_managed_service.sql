CREATE TABLE IF NOT EXISTS managed_accounts (
  user_id text PRIMARY KEY,
  stripe_customer_id text UNIQUE,
  deletion_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entitlements (
  user_id text PRIMARY KEY,
  plan text NOT NULL DEFAULT 'free',
  source text NOT NULL DEFAULT 'free',
  display_name text NOT NULL DEFAULT 'Free',
  subscription_end timestamptz,
  subscription_status text,
  license_status text,
  quota_model text NOT NULL DEFAULT 'cloud_words',
  cloud_words_limit bigint NOT NULL DEFAULT 0 CHECK (cloud_words_limit >= 0),
  byok_unlimited boolean NOT NULL DEFAULT true,
  stripe_subscription_id text UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (plan IN ('free','pro','lifetime_starter','appsumo_tier1','appsumo_tier2','appsumo_tier3')),
  CHECK (source IN ('free','stripe','creem','lifetime','appsumo')),
  CHECK (quota_model IN ('legacy_dual_meter','cloud_words')),
  CHECK (license_status IS NULL OR license_status IN ('pending','active','refunded','deactivated'))
);

CREATE TABLE IF NOT EXISTS usage_windows (
  user_id text NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  stt_seconds_used double precision NOT NULL DEFAULT 0 CHECK (stt_seconds_used >= 0),
  llm_tokens_used bigint NOT NULL DEFAULT 0 CHECK (llm_tokens_used >= 0),
  cloud_words_used bigint NOT NULL DEFAULT 0 CHECK (cloud_words_used >= 0),
  cloud_words_reserved bigint NOT NULL DEFAULT 0 CHECK (cloud_words_reserved >= 0),
  PRIMARY KEY (user_id, period_start)
);

CREATE TABLE IF NOT EXISTS usage_stages (
  user_id text NOT NULL,
  operation_id text NOT NULL,
  stage_key text NOT NULL,
  request_type text NOT NULL,
  usage_kind text NOT NULL,
  status text NOT NULL,
  reserved_units bigint NOT NULL CHECK (reserved_units >= 0),
  settled_units bigint CHECK (settled_units IS NULL OR settled_units >= 0),
  provider_class text NOT NULL,
  request_id text NOT NULL,
  period_start timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  PRIMARY KEY (user_id, stage_key),
  CHECK (request_type IN ('voice_pipeline','ask_anything','connection_benchmark')),
  CHECK (usage_kind IN ('stt','llm','ask')),
  CHECK (status IN ('reserved','completed','released','reconcile'))
);
CREATE INDEX IF NOT EXISTS usage_stages_operation_idx ON usage_stages (user_id, operation_id);
CREATE INDEX IF NOT EXISTS usage_stages_created_idx ON usage_stages (created_at);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id text NOT NULL,
  route text NOT NULL,
  idempotency_key text NOT NULL,
  request_digest text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  PRIMARY KEY (user_id, route, idempotency_key),
  CHECK (state IN ('pending','completed'))
);
CREATE INDEX IF NOT EXISTS idempotency_expiry_idx ON idempotency_records (expires_at);

CREATE TABLE IF NOT EXISTS backup_snapshots (
  user_id text PRIMARY KEY,
  schema_version integer NOT NULL,
  created_at timestamptz NOT NULL,
  key_id text NOT NULL,
  iv bytea NOT NULL,
  ciphertext bytea NOT NULL,
  auth_tag bytea NOT NULL,
  plaintext_digest text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS desktop_oauth_transactions (
  transaction_hash text PRIMARY KEY,
  client_state text NOT NULL UNIQUE,
  code_challenge text NOT NULL,
  provider text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (provider IN ('google','github'))
);
CREATE INDEX IF NOT EXISTS desktop_oauth_transaction_expiry_idx ON desktop_oauth_transactions (expires_at);

CREATE TABLE IF NOT EXISTS desktop_oauth_codes (
  code_hash text PRIMARY KEY,
  user_id text NOT NULL,
  client_state text NOT NULL,
  code_challenge text NOT NULL,
  token_key_id text NOT NULL,
  token_iv bytea NOT NULL,
  token_ciphertext bytea NOT NULL,
  token_auth_tag bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS desktop_oauth_expiry_idx ON desktop_oauth_codes (expires_at);

CREATE TABLE IF NOT EXISTS account_exports (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  key_id text NOT NULL,
  iv bytea NOT NULL,
  ciphertext bytea NOT NULL,
  auth_tag bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_exports_expiry_idx ON account_exports (expires_at);

CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  scope text NOT NULL,
  key_hash text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS rate_limit_window_idx ON rate_limit_buckets (window_start);

CREATE TABLE IF NOT EXISTS billing_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'processing',
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CHECK (status IN ('processing','completed','failed'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  account_hash text,
  event_type text NOT NULL,
  request_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_created_idx ON audit_events (created_at);

CREATE TABLE IF NOT EXISTS account_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (kind IN ('export','deletion')),
  CHECK (status IN ('pending','running','completed','failed'))
);
CREATE INDEX IF NOT EXISTS account_jobs_user_idx ON account_jobs (user_id, created_at DESC);