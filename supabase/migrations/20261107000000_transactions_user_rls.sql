-- Guarantee that a signed-in user can read (and create) their own transactions.
--
-- Why this exists: the dashboard computes
--   available = max(0, totalBalance - totalDeposited - totalPendingWithdrawals)
-- from a SELECT on public.transactions filtered by status = 'pending'. With RLS
-- enabled, a missing or over-narrow own-row policy does not raise an error —
-- PostgREST simply returns an empty result, so the pending total silently reads
-- 0 and the Available Balance never drops after a withdrawal request.
--
-- Idempotent: safe to re-run. Admin policies (public.is_admin()) are separate
-- permissive policies and keep working; permissive policies are OR'd together.
--
-- Diagnose first if the browser console still shows the pending query failing or
-- returning 0 rows:
--   SELECT policyname, permissive, cmd, roles, qual
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename = 'transactions';
-- A missing permissive SELECT row for `authenticated` (or a RESTRICTIVE policy
-- whose qual excludes status = 'pending') is exactly what silently zeroes the
-- dashboard's pending-withdrawal total.

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Read your own rows (deposits, withdrawals, profits, rewards — all statuses).
DROP POLICY IF EXISTS "Users can read own transactions" ON public.transactions;
CREATE POLICY "Users can read own transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Create your own rows, and never on someone else's behalf.
DROP POLICY IF EXISTS "Users can insert own transactions" ON public.transactions;
CREATE POLICY "Users can insert own transactions"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- The dashboard's pending-withdrawal aggregate filters on exactly these columns.
CREATE INDEX IF NOT EXISTS transactions_user_type_status_idx
  ON public.transactions (user_id, type, status);

-- The pending total is money, so make the filter cheap and deterministic.
CREATE INDEX IF NOT EXISTS transactions_user_pending_withdrawals_idx
  ON public.transactions (user_id, created_at DESC)
  WHERE type = 'withdrawal' AND status = 'pending';
