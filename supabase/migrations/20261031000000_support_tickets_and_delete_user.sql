-- Support ticket system + delete-user RPC
--
-- Adds:
--   1) public.support_tickets table with RLS (users insert/read own; admins all).
--   2) public.delete_user(target_user_id) SECURITY DEFINER RPC for admin panel.
--
-- Safe to re-run (idempotent). Run in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) support_tickets table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS support_tickets_user_id_idx
  ON public.support_tickets (user_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON public.support_tickets (status);
CREATE INDEX IF NOT EXISTS support_tickets_created_at_idx
  ON public.support_tickets (created_at DESC);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can insert own tickets" ON public.support_tickets;
CREATE POLICY "Users can insert own tickets"
  ON public.support_tickets FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can read own tickets" ON public.support_tickets;
CREATE POLICY "Users can read own tickets"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can read all tickets" ON public.support_tickets;
CREATE POLICY "Admins can read all tickets"
  ON public.support_tickets FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update tickets" ON public.support_tickets;
CREATE POLICY "Admins can update tickets"
  ON public.support_tickets FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2) delete_user RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF target_user_id = auth.uid() THEN
    RAISE EXCEPTION 'cannot delete self';
  END IF;

  DELETE FROM public.support_tickets WHERE user_id = target_user_id;
  DELETE FROM public.profiles WHERE id = target_user_id;
  DELETE FROM auth.users WHERE id = target_user_id;
END
$$;

REVOKE ALL ON FUNCTION public.admin_delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(uuid) TO authenticated;

-- Backwards-compatible alias.
CREATE OR REPLACE FUNCTION public.delete_user(target_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT public.admin_delete_user(target_user_id);
$$;

REVOKE ALL ON FUNCTION public.delete_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3) Sanity check
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NULL THEN
    RAISE EXCEPTION 'public.support_tickets was not created';
  END IF;
  IF to_regprocedure('public.admin_delete_user(uuid)') IS NULL THEN
    RAISE EXCEPTION 'public.admin_delete_user(uuid) was not created';
  END IF;
  RAISE NOTICE 'Support ticket system SQL applied.';
END $$;