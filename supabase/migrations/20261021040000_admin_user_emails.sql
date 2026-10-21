-- Admin email lookup without profiles.email
--
-- public.profiles has no email column in this database, so PostgREST can
-- neither select it nor embed it (the admin panel used to fail with PGRST204 /
-- "Could not embed"). Emails live in auth.users, which the anon/authenticated
-- keys cannot read, so the panel gets them through this admin-only RPC.
--
-- One call resolves the emails for every user id passed in, so the admin page
-- needs a single extra round-trip instead of one query per transaction.
--
-- Safe to re-run (idempotent). Run in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.admin_user_emails(ids uuid[] DEFAULT NULL)
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id, u.email::text
    FROM auth.users AS u
   WHERE EXISTS (
           SELECT 1
             FROM public.profiles AS p
            WHERE p.id = auth.uid()
              AND p.is_admin = true
         )
     AND (ids IS NULL OR u.id = ANY (ids))
   ORDER BY u.id;
$$;

-- Non-admins get zero rows; nobody else may call it directly either.
REVOKE ALL ON FUNCTION public.admin_user_emails(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_user_emails(uuid[]) TO authenticated;

-- The fallback view referenced profiles.email too, so rebuild it on top of the
-- RPC. security_invoker keeps transactions RLS in force for the caller, while
-- the definer-rights function is the only thing that touches auth.users.
-- DROP + CREATE (rather than CREATE OR REPLACE) so this wins regardless of the
-- column list an earlier attempt left behind.
DROP VIEW IF EXISTS public.admin_pending_transactions;

CREATE VIEW public.admin_pending_transactions
WITH (security_invoker = true)
AS
SELECT
  t.id, t.user_id, t.type, t.amount, t.deposit_amount, t.plan_name,
  t.network, t.wallet_address, t.tx_hash, t.status, t.created_at,
  e.email AS user_email
FROM public.transactions AS t
LEFT JOIN LATERAL public.admin_user_emails(ARRAY[t.user_id]) AS e ON TRUE
WHERE t.status = 'pending'
  AND t.type IN ('deposit', 'withdrawal');

GRANT SELECT ON public.admin_pending_transactions TO authenticated;
