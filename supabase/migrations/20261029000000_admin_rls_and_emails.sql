-- Admin write path + email lookup fix
--
-- Why the admin User Management buttons changed nothing even though reads
-- worked:
--
--   * The admin policies were written as
--       EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() ...)
--     i.e. a policy ON profiles that queries profiles. Depending on the policy
--     set Postgres either raises "infinite recursion detected in policy" or
--     matches no rows. An UPDATE that matches no rows is NOT an error:
--     PostgREST answers 204, so the panel looked like it silently did nothing.
--   * The email lookup relied on admin_user_emails(); where that function was
--     never created the RPC fails (PGRST202) and the table falls back to ids.
--
-- This migration replaces every recursive admin policy with a SECURITY DEFINER
-- is_admin() check (it bypasses RLS, so there is no recursion), adds WITH CHECK
-- so an admin UPDATE is validated against the new row too, and adds
-- get_all_user_emails(). It also backfills profiles.plan_name so the dashboard
-- can treat profiles as the source of truth for the plan window.
--
-- Safe to re-run: every statement is idempotent. Run in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) is_admin(): SECURITY DEFINER so it reads profiles without re-entering RLS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = auth.uid() AND p.is_admin = true
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) profiles: admin read + write, no self-referencing policy
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;

CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3) transactions: same helper for the deposit/withdrawal queues
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can read all transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can update transactions" ON public.transactions;
DROP POLICY IF EXISTS "Admins can insert transactions" ON public.transactions;

CREATE POLICY "Admins can read all transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (public.is_admin());

CREATE POLICY "Admins can update transactions"
  ON public.transactions FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "Admins can insert transactions"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4) Emails. profiles has no email column and auth.users is not exposed by the
--    API, so admins read emails through a definer function. NULL ids = everyone.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_all_user_emails(ids uuid[] DEFAULT NULL)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email::text
    FROM auth.users AS u
   WHERE public.is_admin()
     AND (ids IS NULL OR u.id = ANY (ids))
   ORDER BY u.id;
$$;

REVOKE ALL ON FUNCTION public.get_all_user_emails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_user_emails(uuid[]) TO authenticated;

-- Keep the original name working by delegating to the new implementation.
CREATE OR REPLACE FUNCTION public.admin_user_emails(ids uuid[] DEFAULT NULL)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT e.id, e.email FROM public.get_all_user_emails(ids) AS e;
$$;

REVOKE ALL ON FUNCTION public.admin_user_emails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_emails(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Backfill the plan name/window from the latest completed deposit so the
--    dashboard's profiles-driven plan card keeps working for existing users.
-- ---------------------------------------------------------------------------
WITH latest_deposit AS (
  SELECT DISTINCT ON (t.user_id)
    t.user_id,
    t.plan_name,
    t.created_at
  FROM public.transactions t
  WHERE t.type = 'deposit'
    AND t.status = 'completed'
    AND t.user_id IS NOT NULL
  ORDER BY t.user_id, t.created_at DESC
)
UPDATE public.profiles AS p
SET plan_name = COALESCE(p.plan_name, d.plan_name),
    plan_started_at = COALESCE(p.plan_started_at, d.created_at),
    plan_expires_at = COALESCE(p.plan_expires_at, d.created_at + interval '365 days')
FROM latest_deposit AS d
WHERE p.id = d.user_id;

-- ---------------------------------------------------------------------------
-- 6) Sanity check: the panel calls both functions through PostgREST.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.get_all_user_emails(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'public.get_all_user_emails(uuid[]) was not created';
  END IF;
  IF to_regprocedure('public.admin_user_emails(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'public.admin_user_emails(uuid[]) was not created';
  END IF;
  RAISE NOTICE 'Admin user management SQL applied.';
END $$;
