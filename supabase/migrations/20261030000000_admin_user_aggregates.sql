-- Admin Users tab: earned/available balance aggregates
--
-- The Users tab used to print profiles.main_balance / extra_balance as
-- "balances". main_balance is credited with the deposit amount when a deposit
-- is approved (see distribute_daily_profits and the admin approve flow), so
-- that column showed a user's own deposit back to them as if it were earnings.
--
-- This migration gives the panel one source of truth for money EARNED:
--
--   1) profiles.earnings_adjustment — the manual correction an admin makes from
--      the Edit modal (Total Earned / Available Balance). Deposits never feed
--      into any figure here.
--   2) admin_user_aggregates(ids) — a single SECURITY DEFINER call returning
--      total earned, total withdrawn, available balance, referral count and the
--      stored adjustment for every requested profile, so the Users tab loads
--      with one extra round-trip instead of per-row queries.
--
-- Definitions (kept in sync with src/routes/admin.tsx):
--   total earned     = SUM(amount) of COMPLETED daily_profit + ad_earning +
--                      referral_bonus transactions, plus earnings_adjustment
--   total withdrawn  = SUM(ABS(amount)) of withdrawal transactions that are
--                      COMPLETED or PENDING
--   available        = total earned - total withdrawn
--   referrals        = profiles whose referred_by = the user
--
-- Safe to re-run: every statement is idempotent. Run in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1) Manual earnings adjustment (defaults to 0 = pure transaction earnings)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS earnings_adjustment numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.earnings_adjustment IS
  'Manual earnings correction applied by an admin from the Users tab. Added to completed earnings; deposits are never included.';

-- ---------------------------------------------------------------------------
-- 2) Aggregates for the Users tab (one call for every row on the page)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_aggregates(ids uuid[] DEFAULT NULL)
RETURNS TABLE (
  user_id uuid,
  total_earned numeric,
  total_withdrawn numeric,
  available_balance numeric,
  referral_count integer,
  earnings_adjustment numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH scope AS (
    SELECT p.id, COALESCE(p.earnings_adjustment, 0) AS adjustment
      FROM public.profiles p
     WHERE public.is_admin()
       AND (ids IS NULL OR p.id = ANY (ids))
  ),
  earned AS (
    SELECT t.user_id, SUM(t.amount) AS amount
      FROM public.transactions t
      JOIN scope s ON s.id = t.user_id
     WHERE t.status = 'completed'
       AND t.type IN ('daily_profit', 'ad_earning', 'referral_bonus')
     GROUP BY t.user_id
  ),
  withdrawn AS (
    SELECT t.user_id, SUM(ABS(t.amount)) AS amount
      FROM public.transactions t
      JOIN scope s ON s.id = t.user_id
     WHERE t.type = 'withdrawal'
       AND t.status IN ('completed', 'pending')
     GROUP BY t.user_id
  ),
  referrals AS (
    SELECT p.referred_by AS user_id, COUNT(*)::integer AS total
      FROM public.profiles p
      JOIN scope s ON s.id = p.referred_by
     GROUP BY p.referred_by
  )
  SELECT s.id,
         ROUND(COALESCE(e.amount, 0) + s.adjustment, 2),
         ROUND(COALESCE(w.amount, 0), 2),
         ROUND(COALESCE(e.amount, 0) + s.adjustment - COALESCE(w.amount, 0), 2),
         COALESCE(r.total, 0),
         ROUND(s.adjustment, 2)
    FROM scope s
    LEFT JOIN earned e ON e.user_id = s.id
    LEFT JOIN withdrawn w ON w.user_id = s.id
    LEFT JOIN referrals r ON r.user_id = s.id;
$$;

REVOKE ALL ON FUNCTION public.admin_user_aggregates(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_aggregates(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_aggregates(uuid[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Indexes the aggregates read (user_id/type/status + referral lookups)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS transactions_user_type_status_idx
  ON public.transactions (user_id, type, status);

CREATE INDEX IF NOT EXISTS profiles_referred_by_idx
  ON public.profiles (referred_by);

-- ---------------------------------------------------------------------------
-- 4) Sanity check
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.admin_user_aggregates(uuid[])') IS NULL THEN
    RAISE EXCEPTION 'public.admin_user_aggregates(uuid[]) was not created';
  END IF;
  RAISE NOTICE 'Admin user aggregate SQL applied.';
END $$;
