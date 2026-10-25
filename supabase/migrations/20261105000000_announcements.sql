-- Announcements table for dynamic dashboard notifications
-- Safe to re-run (idempotent). Run in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) announcements table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL DEFAULT 'info',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS announcements_created_at_idx
  ON public.announcements (created_at DESC);

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can view active announcements.
DROP POLICY IF EXISTS "Anyone can view active announcements" ON public.announcements;
CREATE POLICY "Anyone can view active announcements"
  ON public.announcements FOR SELECT TO authenticated
  USING (is_active = true OR public.is_admin());

-- Admins can manage all announcements (insert/update/delete).
DROP POLICY IF EXISTS "Admins can insert announcements" ON public.announcements;
CREATE POLICY "Admins can insert announcements"
  ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
CREATE POLICY "Admins can update announcements"
  ON public.announcements FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;
CREATE POLICY "Admins can delete announcements"
  ON public.announcements FOR DELETE TO authenticated
  USING (public.is_admin());

-- Sanity check
DO $$
BEGIN
  IF to_regclass('public.announcements') IS NULL THEN
    RAISE EXCEPTION 'public.announcements was not created';
  END IF;
  RAISE NOTICE 'Announcements SQL applied.';
END $$;
