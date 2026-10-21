-- Fix profile creation on signup.
--
-- Problem: public.handle_new_user() inserted (id, full_name, email, referred_by)
-- into public.profiles, but the deployed profiles table has no email column, so
-- every new signup failed inside the trigger with:
--   ERROR: column "email" of relation "profiles" does not exist
-- and no profile row was created (which is why the dashboard then reported a
-- missing profile).
--
-- This migration:
--   1) rewrites handle_new_user() to write ONLY id, full_name and kyc_status
--      (no email — the column does not exist);
--   2) re-attaches it to auth.users as on_auth_user_created;
--   3) backfills profiles for existing auth users that never got one.
--
-- Safe to re-run (idempotent). Run it in the Supabase SQL Editor.

-- 1) Make sure the columns the trigger writes really exist.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kyc_status text;

UPDATE public.profiles
   SET kyc_status = 'unverified'
 WHERE kyc_status IS NULL OR btrim(kyc_status) = '';

-- 2) Rewrite the trigger function: id + full_name + kyc_status only.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_full_name       text;
  v_referral_code   text;
  v_referred_by     uuid;
  v_has_referred_by boolean;
  v_has_ref_code    boolean;
BEGIN
  -- Display name from signup metadata, falling back to the email local part.
  v_full_name := COALESCE(
    NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(COALESCE(NEW.email, 'user'), '@', 1)
  );

  -- Referrals are optional extras: only touch them when the columns exist, so
  -- a leaner profiles table can never break signup again.
  SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'profiles'
              AND column_name = 'referred_by'
         )
    INTO v_has_referred_by;

  SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'profiles'
              AND column_name = 'referral_code'
         )
    INTO v_has_ref_code;

  IF v_has_referred_by THEN
    IF (NEW.raw_user_meta_data ->> 'referred_by')
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_referred_by := (NEW.raw_user_meta_data ->> 'referred_by')::uuid;
    END IF;

    IF v_has_ref_code THEN
      v_referral_code := NULLIF(upper(btrim(NEW.raw_user_meta_data ->> 'referral_code')), '');

      IF v_referred_by IS NULL AND v_referral_code IS NOT NULL THEN
        SELECT p.id
          INTO v_referred_by
          FROM public.profiles AS p
         WHERE upper(p.referral_code) = v_referral_code
         LIMIT 1;
      END IF;
    END IF;

    IF v_referred_by = NEW.id THEN
      v_referred_by := NULL;
    END IF;
  END IF;

  -- NOTE: email is intentionally NOT written — profiles has no email column.
  INSERT INTO public.profiles AS p (id, full_name, kyc_status)
  VALUES (NEW.id, v_full_name, 'unverified')
  ON CONFLICT (id) DO UPDATE
     SET full_name  = COALESCE(NULLIF(p.full_name, ''), EXCLUDED.full_name),
         kyc_status = COALESCE(p.kyc_status, EXCLUDED.kyc_status);

  IF v_has_referred_by AND v_referred_by IS NOT NULL THEN
    UPDATE public.profiles AS p
       SET referred_by = COALESCE(p.referred_by, v_referred_by)
     WHERE p.id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Attach the trigger to auth.users (drop first so re-runs don't duplicate it).
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4) Backfill profiles for existing users that never got one.
INSERT INTO public.profiles AS t (id, full_name, kyc_status)
SELECT u.id,
       COALESCE(
         NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
         split_part(COALESCE(u.email, 'user'), '@', 1)
       ),
       'unverified'
  FROM auth.users AS u
  LEFT JOIN public.profiles AS existing ON existing.id = u.id
 WHERE existing.id IS NULL
ON CONFLICT (id) DO NOTHING;
