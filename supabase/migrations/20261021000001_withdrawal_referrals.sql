-- Withdrawal + Referral dashboard migration
-- Run this in Supabase SQL Editor. Safe to re-run (idempotent).

-- 1) profiles: track last withdrawal for the 7-day rule
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_withdraw_at timestamptz NULL;

-- 2) transactions already supports generic type/status/amount/user_id
--    rows, but ensure the withdrawal payload fits:
--    type='withdrawal', amount negative, status='pending',
--    wallet_address = crypto address. Relax columns if still NOT NULL.
ALTER TABLE public.transactions ALTER COLUMN deposit_amount DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN network DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN plan_name DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN tx_hash DROP NOT NULL;

-- 3) referrals (MLM-ready): profiles.referred_by stores the referrer's
--    user id. Index it for the "My Referrals" lookup
--    (WHERE referred_by = currentUser.id).
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx
  ON public.profiles (referred_by);

-- 4) capture referred_by at signup: auth metadata (referred_by) -> profiles.
--    Works whether the profile row is created by a trigger or manual insert.
CREATE OR REPLACE FUNCTION public.handle_referral_on_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_referred_by text;
BEGIN
  IF NEW.referred_by IS NULL THEN
    SELECT (raw_user_meta_data ->> 'referred_by')
      INTO meta_referred_by
      FROM auth.users
      WHERE id = NEW.id;
    IF meta_referred_by IS NOT NULL AND meta_referred_by <> '' THEN
      NEW.referred_by := meta_referred_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_referral_capture ON public.profiles;
CREATE TRIGGER profiles_referral_capture
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_referral_on_profile();

-- 5) resolve referral codes from signup links.
--    Accepts the full user id (?ref=USER_ID) or the 8-char short code
--    shown on the dashboard (?ref=AB12CD34, case-insensitive).
CREATE OR REPLACE FUNCTION public.resolve_referral_code(code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
    FROM public.profiles AS p
   WHERE p.id::text = NULLIF(btrim(code), '')
      OR upper(left(p.id::text, 8)) = upper(NULLIF(btrim(code), ''))
      OR upper(p.referral_code) = upper(NULLIF(btrim(code), ''))
   LIMIT 1;
$$;

