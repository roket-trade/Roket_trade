-- 0007_dashboard_profile_fields.sql
-- Dashboard v2 profile fields. Mirrors
-- supabase/migrations/20261022000000_dashboard_profile_fields.sql.
-- All statements are idempotent so re-applying the migration is safe.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone_number text NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS default_wallet_address text NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_started_at timestamptz NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_expires_at timestamptz NULL;

-- Backfill the active plan window from the latest completed deposit.
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

CREATE INDEX IF NOT EXISTS profiles_plan_expires_at_idx
  ON public.profiles (plan_expires_at);
