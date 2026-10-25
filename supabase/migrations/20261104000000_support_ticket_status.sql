-- Ensure support_tickets.status allows 'open', 'replied', 'resolved'
-- Safe to re-run (idempotent).

DO $$
BEGIN
  -- Drop any existing status check constraint (common default name) if present.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'support_tickets_status_check'
      AND conrelid = 'public.support_tickets'::regclass
  ) THEN
    ALTER TABLE public.support_tickets
      DROP CONSTRAINT support_tickets_status_check;
  END IF;

  ALTER TABLE public.support_tickets
    ADD CONSTRAINT support_tickets_status_check
    CHECK (status IN ('open', 'replied', 'resolved'));
END $$;

DO $$
BEGIN
  IF to_regclass('public.support_tickets') IS NULL THEN
    RAISE EXCEPTION 'public.support_tickets was not created';
  END IF;
  RAISE NOTICE 'Support ticket status constraint applied.';
END $$;
