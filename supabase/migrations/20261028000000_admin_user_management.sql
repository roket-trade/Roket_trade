-- Admin user management
--
-- Adds the account-hold flag the admin panel toggles and the indexes it needs
-- to list/search users. The admin policies that let an admin read and update
-- every profile already exist in 20261021000000_add_is_admin.sql, so this
-- migration only adds the column + supporting index.
--
-- Safe to re-run (idempotent). Run in the Supabase SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_suspended IS
  'When true the account is held: login is refused and an admin must unhold it.';

CREATE INDEX IF NOT EXISTS profiles_is_suspended_idx
  ON public.profiles (is_suspended);
