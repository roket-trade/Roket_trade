-- Wallet + Extra Income (Watch Ads) migration
-- Run this in Supabase SQL Editor. Safe to re-run (idempotent).

-- 1) profiles: wallet balances
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS main_balance numeric NOT NULL DEFAULT 0;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS extra_balance numeric NOT NULL DEFAULT 0;

-- 2) transactions: relax deposit-specific columns so ad_earning rows
--    (type/amount/status/user_id only) can be inserted.
--    Existing deposit rows are unaffected.
ALTER TABLE public.transactions ALTER COLUMN deposit_amount DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN network DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN plan_name DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN wallet_address DROP NOT NULL;
ALTER TABLE public.transactions ALTER COLUMN tx_hash DROP NOT NULL;

-- Optional: backfill nulls to sensible defaults for existing rows
-- UPDATE public.transactions SET deposit_amount = COALESCE(deposit_amount, amount, 0) WHERE deposit_amount IS NULL;
