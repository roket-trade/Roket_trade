-- Rename legacy admin_response column to admin_reply (idempotent).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'support_tickets'
      AND column_name = 'admin_response'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'support_tickets'
      AND column_name = 'admin_reply'
  ) THEN
    ALTER TABLE public.support_tickets RENAME COLUMN admin_response TO admin_reply;
  END IF;
END $$;
