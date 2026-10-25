-- Support ticket system upgrade: category + image_url
--
-- Adds category and image_url columns to public.support_tickets.
-- Safe to re-run (idempotent). Run in the Supabase SQL Editor.

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS image_url text;

CREATE INDEX IF NOT EXISTS support_tickets_category_idx
  ON public.support_tickets (category);

DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NULL THEN
    RAISE EXCEPTION 'public.support_tickets was not created';
  END IF;
  RAISE NOTICE 'Support ticket upgrade SQL applied.';
END $$;