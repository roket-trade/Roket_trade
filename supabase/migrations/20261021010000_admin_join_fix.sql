-- Admin join fix: FK + fallback view + is_admin() helper
-- Run in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS guards).

-- 1) Helper used by your RLS policies: public.is_admin()
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 2) FK so PostgREST can embed profiles(email) in one query.
-- If transactions.user_id has values with no matching profile, the
-- NOT VALID form still creates the constraint without scanning; validate later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

-- 3) Fallback view joining email explicitly (works even if the client
-- can't use the FK embed). Admin-only via RLS-friendly security invoker.
CREATE OR REPLACE VIEW public.admin_pending_transactions
WITH (security_invoker = true)
AS
SELECT
  t.id, t.user_id, t.type, t.amount, t.deposit_amount, t.plan_name,
  t.network, t.wallet_address, t.tx_hash, t.status, t.created_at,
  p.email AS user_email
FROM public.transactions t
LEFT JOIN public.profiles p ON p.id = t.user_id
WHERE t.status = 'pending'
  AND t.type IN ('deposit', 'withdrawal');
GRANT SELECT ON public.admin_pending_transactions TO authenticated;
