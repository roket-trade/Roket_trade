-- Dashboard v2 — profile fields for the premium dashboard top cards.
-- Run this in the Supabase SQL Editor (or via `supabase db push`).
-- Safe to re-run: every statement is idempotent.

-- 1) Contact + payout details
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_number text NULL;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_wallet_address text NULL;

-- 2) Active plan window, used to draw the "Day X / 365" progress bar.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_started_at timestamptz NULL;
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz NULL;

COMMENT ON COLUMN public.profiles.phone_number IS 'Optional contact phone number for the account holder.';
COMMENT ON COLUMN public.profiles.default_wallet_address IS 'Last wallet address used for a withdrawal request; pre-fills the next one.';
COMMENT ON COLUMN public.profiles.plan_started_at IS 'Start of the currently active 365-day plan window.';
COMMENT ON COLUMN public.profiles.plan_expires_at IS 'End of the currently active plan window (plan_started_at + 365 days).';

-- 3) Backfill the plan window for accounts that already have an approved
--    deposit but no plan dates yet. The latest completed deposit is the
--    active plan, matching the source used by distribute_daily_profits().
WITH latest_deposit AS (
  SELECT DISTINCT ON (t.user_id)
    t.user_id,
    t.created_at
  FROM public.transactions t
  WHERE t.type = 'deposit'
    AND t.status = 'completed'
    AND t.user_id IS NOT NULL
  ORDER BY t.user_id, t.created_at DESC
)
UPDATE public.profiles AS p
SET plan_started_at = COALESCE(p.plan_started_at, d.created_at),
    plan_expires_at = COALESCE(p.plan_expires_at, d.created_at + interval '365 days')
FROM latest_deposit AS d
WHERE p.id = d.user_id;

-- 4) Fast lookup for expiry-driven plan checks.
CREATE INDEX IF NOT EXISTS profiles_plan_expires_at_idx
  ON public.profiles (plan_expires_at);
