-- 0006_transactions_amount.sql
-- Live DB has public.transactions.amount NOT NULL, but local migrations never
-- created it. Also set a DEFAULT 0 on deposit_amount as requested.
-- Idempotent.

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS amount numeric(12,2);

-- Backfill from deposit_amount where possible, else 0, to satisfy NOT NULL.
UPDATE public.transactions SET amount = deposit_amount WHERE amount IS NULL AND deposit_amount IS NOT NULL;
UPDATE public.transactions SET amount = 0 WHERE amount IS NULL;
UPDATE public.payments SET amount = deposit_amount WHERE amount IS NULL AND deposit_amount IS NOT NULL;
UPDATE public.payments SET amount = 0 WHERE amount IS NULL;

ALTER TABLE public.transactions ALTER COLUMN amount SET DEFAULT 0;
ALTER TABLE public.payments ALTER COLUMN amount SET DEFAULT 0;

ALTER TABLE public.transactions ALTER COLUMN deposit_amount SET DEFAULT 0;
ALTER TABLE public.payments ALTER COLUMN deposit_amount SET DEFAULT 0;

ALTER TABLE public.transactions ALTER COLUMN amount SET NOT NULL;
ALTER TABLE public.payments ALTER COLUMN amount SET NOT NULL;
