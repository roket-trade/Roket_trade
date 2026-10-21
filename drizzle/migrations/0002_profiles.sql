-- 0002_profiles.sql
-- Public user profile records, created by the on_auth_user_created trigger on signup.
-- All statements are idempotent so re-applying the migration is safe.

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  email text,
  referral_code text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill referral_code for any rows created before this migration.
UPDATE public.profiles
SET referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
WHERE referral_code IS NULL OR btrim(referral_code) = '';

-- Enforce uniqueness on referral_code (some older runs may have left it nullable).
ALTER TABLE public.profiles ALTER COLUMN referral_code SET NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN full_name SET NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON public.profiles (referred_by);
CREATE INDEX IF NOT EXISTS profiles_referral_code_idx ON public.profiles (referral_code);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE OR REPLACE FUNCTION public.resolve_referral_code(code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.profiles WHERE referral_code = upper(trim(code)) LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_referral_code(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_referral_code text;
  v_referred_by uuid;
BEGIN
  v_full_name := COALESCE(
    NULLIF(trim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    split_part(COALESCE(NEW.email, 'user'), '@', 1)
  );
  v_referral_code := NULLIF(upper(trim(NEW.raw_user_meta_data ->> 'referral_code')), '');

  IF (NEW.raw_user_meta_data ->> 'referred_by') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_referred_by := (NEW.raw_user_meta_data ->> 'referred_by')::uuid;
  END IF;

  IF v_referred_by IS NULL AND v_referral_code IS NOT NULL THEN
    SELECT id INTO v_referred_by
    FROM public.profiles
    WHERE referral_code = v_referral_code
    LIMIT 1;
  END IF;

  IF v_referred_by = NEW.id THEN
    v_referred_by := NULL;
  END IF;

  -- NOTE: profiles has no email column, so only the columns that exist here are
  -- written. kyc_status is added by 0003_kyc.sql and written by the newer
  -- function in supabase/migrations/20261021030000_fix_handle_new_user.sql.
  INSERT INTO public.profiles AS p (id, full_name, referred_by)
  VALUES (NEW.id, v_full_name, v_referred_by)
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        referred_by = COALESCE(p.referred_by, EXCLUDED.referred_by);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();