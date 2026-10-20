-- Automated daily profits for Roket_trade
-- Run in Supabase SQL Editor (needs pg_cron + pg_net on the project).
--
-- Active plan = user's LATEST completed deposit (plan_name -> daily rate).
-- Plan 1 ($60) = $1/day, Plan 2 ($120) = $3/day,
-- Plan 3 ($180) = $4.50/day, Plan 4 ($250) = $8/day.
-- Each run credits main_balance and logs a 'daily_profit' transaction.
-- Idempotent per UTC day via a unique guard (no double-pay on re-run).

-- 0) Extensions (Supabase: enable via Dashboard > Database > Extensions if needed)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 1) Guard table: one row per distribution day
CREATE TABLE IF NOT EXISTS public.profit_distributions (
  day date PRIMARY KEY,
  ran_at timestamptz NOT NULL DEFAULT now(),
  users_paid integer NOT NULL DEFAULT 0,
  total_paid numeric NOT NULL DEFAULT 0
);

-- 2) Main function (SECURITY DEFINER so cron can write despite RLS)
CREATE OR REPLACE FUNCTION public.distribute_daily_profits()
RETURNS TABLE (users_paid integer, total_paid numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  today_day date := (now() AT TIME ZONE 'UTC')::date;
  v_users integer := 0;
  v_total numeric := 0;
BEGIN
  -- Idempotency: skip if today already distributed
  IF EXISTS (SELECT 1 FROM public.profit_distributions WHERE day = today_day) THEN
    RETURN QUERY SELECT 0, 0::numeric;
    RETURN;
  END IF;

  -- Credit each user by their latest completed deposit's plan
  WITH latest_deposit AS (
    SELECT DISTINCT ON (t.user_id)
      t.user_id,
      t.plan_name,
      COALESCE(t.deposit_amount, t.amount) AS deposit_amount
    FROM public.transactions t
    WHERE t.type = 'deposit' AND t.status = 'completed' AND t.user_id IS NOT NULL
    ORDER BY t.user_id, t.created_at DESC
  ),
  rates AS (
    SELECT
      user_id,
      CASE
        WHEN plan_name ILIKE '%plan 4%' OR deposit_amount >= 250 THEN 8
        WHEN plan_name ILIKE '%plan 3%' OR deposit_amount >= 180 THEN 4.5
        WHEN plan_name ILIKE '%plan 2%' OR deposit_amount >= 120 THEN 3
        WHEN plan_name ILIKE '%plan 1%' OR deposit_amount >= 60 THEN 1
        ELSE 0
      END AS daily_profit
    FROM latest_deposit
  ),
  payable AS (
    SELECT user_id, daily_profit FROM rates WHERE daily_profit > 0
  ),
  credited AS (
    UPDATE public.profiles p
    SET main_balance = ROUND((COALESCE(p.main_balance, 0) + pay.daily_profit) * 100) / 100
    FROM payable pay
    WHERE p.id = pay.user_id
    RETURNING p.id, pay.daily_profit
  ),
  logged AS (
    INSERT INTO public.transactions (user_id, type, amount, status, plan_name)
    SELECT id, 'daily_profit', daily_profit, 'completed', 'Daily Profit'
    FROM credited
    RETURNING amount
  )
  SELECT COUNT(*)::integer, COALESCE(SUM(amount), 0) INTO v_users, v_total FROM logged;

  INSERT INTO public.profit_distributions (day, users_paid, total_paid)
  VALUES (today_day, v_users, v_total)
  ON CONFLICT (day) DO NOTHING;

  RETURN QUERY SELECT v_users, v_total;
END;
$$;

-- Allow the cron job (postgres role) + admins to execute
GRANT EXECUTE ON FUNCTION public.distribute_daily_profits() TO authenticated, service_role;
GRANT SELECT, INSERT ON public.profit_distributions TO service_role;

-- 3) Schedule: every day at 00:00 UTC
SELECT cron.unschedule('distribute-daily-profits') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'distribute-daily-profits'
);
SELECT cron.schedule(
  'distribute-daily-profits',
  '0 0 * * *',
  $$SELECT * FROM public.distribute_daily_profits();$$
);

-- 4) Manual test (pays today once; re-runs same day are no-ops):
-- SELECT * FROM public.distribute_daily_profits();
-- SELECT * FROM public.profit_distributions ORDER BY day DESC LIMIT 7;
