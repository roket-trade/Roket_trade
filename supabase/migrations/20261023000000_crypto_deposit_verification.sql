-- Automated crypto deposit verification (Phase 1 + 2)
--
-- 1) Adds the columns the verify-crypto-deposit Edge Function writes.
-- 2) Publishes public.transactions to Supabase Realtime so the checkout bar can
--    subscribe to UPDATE events for its tx_hash.
-- 3) Installs public.trigger_pending_deposit_verifications(), which finds
--    pending BEP20/SOL deposits and POSTs each one to the Edge Function via
--    pg_net (free — pg_cron + pg_net are included with Supabase).
-- 4) Schedules that function every 30 seconds with pg_cron.
--
-- Safe to re-run: every statement is idempotent.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ---------------------------------------------------------------------------
-- 1) Schema
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_name text NULL;

COMMENT ON COLUMN public.profiles.plan_name IS
  'Name of the currently active plan (Plan 1..4), set when a deposit is verified.';

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS last_verification_at timestamptz NULL;
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS rejection_reason text NULL;

COMMENT ON COLUMN public.transactions.verification_attempts IS
  'How many times the 30s cron poller has asked the Edge Function to verify this deposit.';
COMMENT ON COLUMN public.transactions.last_verification_at IS
  'Last time the Edge Function checked this deposit on-chain.';
COMMENT ON COLUMN public.transactions.rejection_reason IS
  'Human-readable reason when on-chain verification rejects a deposit.';

-- Fast scan for the poller (pending deposits only).
CREATE INDEX IF NOT EXISTS transactions_pending_crypto_deposits_idx
  ON public.transactions (created_at)
  WHERE type = 'deposit' AND status = 'pending' AND tx_hash IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Realtime: UPDATE events on transactions (needed by PaymentVerificationBar)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'transactions'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication
       WHERE pubname = 'supabase_realtime' AND puballtables
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Config lookup (Supabase Vault first, database settings as a fallback)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_deposit_setting(p_name text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_value text;
BEGIN
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE
      'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 ORDER BY created_at DESC LIMIT 1'
      INTO v_value
      USING p_name;
  END IF;

  IF v_value IS NULL THEN
    v_value := current_setting('app.settings.' || p_name, true);
  END IF;

  RETURN NULLIF(btrim(v_value), '');
END;
$$;

REVOKE ALL ON FUNCTION public.verify_deposit_setting(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_deposit_setting(text) FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Poller: claim due pending deposits, then call the Edge Function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_pending_deposit_verifications()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project_url text;
  v_secret text;
  v_dispatched integer := 0;
  r record;
BEGIN
  v_project_url := public.verify_deposit_setting('verify_deposit_project_url');
  v_secret := COALESCE(
    public.verify_deposit_setting('verify_deposit_cron_secret'),
    public.verify_deposit_setting('service_role_key')
  );

  IF v_project_url IS NULL OR v_secret IS NULL THEN
    RAISE WARNING
      'verify-crypto-deposit skipped: store verify_deposit_project_url and verify_deposit_cron_secret in Supabase Vault (see bottom of this migration).';
    RETURN 0;
  END IF;

  FOR r IN
    WITH candidates AS (
      SELECT t.id
      FROM public.transactions t
      WHERE t.type = 'deposit'
        AND t.status = 'pending'
        AND t.tx_hash IS NOT NULL
        AND t.network IN ('BEP20', 'SOL')
        AND t.created_at > now() - interval '24 hours'
        -- Cap retries: after ~30 minutes the deposit stays pending for a human
        -- to review instead of hammering the public RPC forever.
        AND t.verification_attempts < 60
        AND (
          t.last_verification_at IS NULL
          OR t.last_verification_at < now() - interval '25 seconds'
        )
      ORDER BY t.created_at
      -- Safety cap per tick; anything beyond this waits for the next 30s run.
      LIMIT 25
      FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
      UPDATE public.transactions t
      SET verification_attempts = t.verification_attempts + 1,
          last_verification_at = now()
      FROM candidates c
      WHERE t.id = c.id
      RETURNING t.id, t.tx_hash, t.network, t.plan_name, t.user_id
    )
    SELECT * FROM claimed
  LOOP
    PERFORM net.http_post(
      url := rtrim(v_project_url, '/') || '/functions/v1/verify-crypto-deposit',
      body := jsonb_build_object(
        'tx_hash', r.tx_hash,
        'network', r.network,
        'plan_id', NULLIF(regexp_replace(COALESCE(r.plan_name, ''), '\D', '', 'g'), ''),
        'user_id', r.user_id,
        'transaction_id', r.id
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_secret,
        'x-cron-secret', v_secret
      ),
      timeout_milliseconds := 15000
    );
    v_dispatched := v_dispatched + 1;
  END LOOP;

  RETURN v_dispatched;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_pending_deposit_verifications() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_pending_deposit_verifications() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_pending_deposit_verifications() TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Schedule: every 30 seconds
-- ---------------------------------------------------------------------------
SELECT cron.unschedule('verify-pending-crypto-deposits')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'verify-pending-crypto-deposits'
);

SELECT cron.schedule(
  'verify-pending-crypto-deposits',
  '30 seconds',
  $$SELECT public.trigger_pending_deposit_verifications();$$
);

-- If your pg_cron version rejects interval syntax, use this instead:
-- SELECT cron.schedule(
--   'verify-pending-crypto-deposits',
--   '* * * * *',
--   $$SELECT public.trigger_pending_deposit_verifications();$$
-- );

-- ---------------------------------------------------------------------------
-- 6) One-time configuration (run these manually, replace the values)
-- ---------------------------------------------------------------------------
-- The URL must be your project URL (no trailing slash) and the secret must be
-- the same value you set as the Edge Function's VERIFY_DEPOSIT_SECRET.
--
-- SELECT vault.create_secret('https://<project-ref>.supabase.co', 'verify_deposit_project_url');
-- SELECT vault.create_secret('<VERIFY_DEPOSIT_SECRET>', 'verify_deposit_cron_secret');
--
-- No Vault? Set database settings instead (then reconnect or restart PostgREST):
-- ALTER DATABASE postgres SET app.settings.verify_deposit_project_url = 'https://<project-ref>.supabase.co';
-- ALTER DATABASE postgres SET app.settings.verify_deposit_cron_secret = '<VERIFY_DEPOSIT_SECRET>';
--
-- Verify the job and run one poll manually:
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'verify-pending-crypto-deposits';
-- SELECT public.trigger_pending_deposit_verifications();
-- SELECT id, status, verification_attempts, last_verification_at, rejection_reason
-- FROM public.transactions WHERE type = 'deposit' ORDER BY created_at DESC LIMIT 10;

