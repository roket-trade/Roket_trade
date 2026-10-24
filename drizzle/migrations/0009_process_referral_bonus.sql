-- 0009_process_referral_bonus.sql
-- Mirrors supabase/migrations/20261025000000_process_referral_bonus.sql.
-- Atomic 10% referral bonus for auto-verified deposits.
--
-- The verify-crypto-deposit Edge Function marks a crypto deposit `completed`
-- and activates the buyer's plan, but nothing paid the referrer. Awarding the
-- bonus needs two writes — credit profiles.main_balance and insert the
-- transactions row — and the Supabase JS client cannot wrap them in a single
-- transaction. public.process_referral_bonus() therefore does both atomically
-- (one database transaction) and is idempotent, so retries or overlapping
-- poller ticks can never pay the same deposit twice.
--
-- Safe to re-run (idempotent).

-- ---------------------------------------------------------------------------
-- 1) Link a bonus back to the deposit that produced it
-- ---------------------------------------------------------------------------
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS source_tx_id uuid
    REFERENCES public.transactions (id) ON DELETE SET NULL;

-- One referral_bonus per deposit.
CREATE UNIQUE INDEX IF NOT EXISTS transactions_referral_bonus_source_key
  ON public.transactions (source_tx_id)
  WHERE type = 'referral_bonus' AND source_tx_id IS NOT NULL;

COMMENT ON COLUMN public.transactions.source_tx_id IS
  'For type = referral_bonus: the completed deposit transaction that generated the bonus.';


-- ---------------------------------------------------------------------------
-- 2) Atomic award
-- ---------------------------------------------------------------------------
-- Returns jsonb, e.g.
--   {"awarded": true,  "reason": "ok", "bonus": 6.00, "referrer_id": "...",
--    "deposit_tx_id": "...", "transaction_id": "..."}
--   {"awarded": false, "reason": "no_referrer" | "referrer_not_found" |
--    "already_awarded" | "deposit_not_completed" | ...}
--
-- Expected conditions are reported, not raised: the Edge Function logs the
-- reason and keeps the already-confirmed deposit untouched.
CREATE OR REPLACE FUNCTION public.process_referral_bonus(p_deposit_tx_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deposit        public.transactions%ROWTYPE;
  v_depositor_name text;
  v_referred_by    text;
  v_referrer       uuid;
  v_base           numeric;
  v_bonus          numeric;
  v_bonus_tx_id    uuid;
BEGIN
  -- Lock the deposit row: overlapping invocations for the same deposit serialise
  -- here, so only one of them can get past the "already awarded" check below.
  SELECT * INTO v_deposit
    FROM public.transactions
   WHERE id = p_deposit_tx_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'deposit_not_found');
  END IF;

  IF v_deposit.type <> 'deposit' THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'not_a_deposit');
  END IF;

  IF v_deposit.status <> 'completed' THEN
    RETURN jsonb_build_object(
      'awarded', false,
      'reason', 'deposit_not_completed',
      'status', v_deposit.status
    );
  END IF;

  IF v_deposit.user_id IS NULL THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'deposit_without_user');
  END IF;

  -- profiles.referred_by is text in the live schema (uuid in some builds), so
  -- read it as text and cast explicitly below.
  SELECT NULLIF(btrim(COALESCE(p.referred_by::text, '')), ''),
         p.full_name
    INTO v_referred_by, v_depositor_name
    FROM public.profiles AS p
   WHERE p.id = v_deposit.user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'depositor_profile_not_found');
  END IF;

  IF v_referred_by IS NULL THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'no_referrer');
  END IF;

  -- Legacy rows may hold a short code instead of a user id; skip those instead
  -- of failing the whole call.
  BEGIN
    v_referrer := v_referred_by::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'invalid_referrer_id');
  END;

  IF v_referrer = v_deposit.user_id THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'self_referral');
  END IF;

  v_base  := COALESCE(NULLIF(v_deposit.deposit_amount, 0), v_deposit.amount, 0);
  v_bonus := round(v_base * 0.10, 2);

  IF v_bonus IS NULL OR v_bonus <= 0 THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'non_positive_bonus');
  END IF;

  -- Lock the referrer so concurrent bonuses cannot lose an update, and verify
  -- the profile really exists.
  PERFORM 1 FROM public.profiles WHERE id = v_referrer FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'referrer_not_found');
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.transactions
     WHERE type = 'referral_bonus'
       AND source_tx_id = p_deposit_tx_id
  ) THEN
    RETURN jsonb_build_object('awarded', false, 'reason', 'already_awarded', 'bonus', v_bonus);
  END IF;

  BEGIN
    INSERT INTO public.transactions (
      user_id,
      type,
      amount,
      status,
      referred_user_id,
      source_tx_id,
      description
    )
    VALUES (
      v_referrer,
      'referral_bonus',
      v_bonus,
      'completed',
      v_deposit.user_id,
      p_deposit_tx_id,
      '10% Referral bonus from '
        || COALESCE(NULLIF(btrim(v_depositor_name), ''), 'a referred user')
    )
    RETURNING id INTO v_bonus_tx_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost a race against another invocation: the bonus already exists.
    RETURN jsonb_build_object('awarded', false, 'reason', 'already_awarded', 'bonus', v_bonus);
  END;

  UPDATE public.profiles
     SET main_balance = round(COALESCE(main_balance, 0) + v_bonus, 2)
   WHERE id = v_referrer;

  RETURN jsonb_build_object(
    'awarded', true,
    'reason', 'ok',
    'bonus', v_bonus,
    'referrer_id', v_referrer,
    'deposit_tx_id', p_deposit_tx_id,
    'transaction_id', v_bonus_tx_id
  );
END;
$$;

COMMENT ON FUNCTION public.process_referral_bonus(uuid) IS
  'Atomically credits the referrer 10% of a completed deposit and records the referral_bonus transaction. Idempotent per deposit.';

-- Only the service role (the Edge Function) may award bonuses.
REVOKE ALL ON FUNCTION public.process_referral_bonus(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_referral_bonus(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_referral_bonus(uuid) TO service_role;
