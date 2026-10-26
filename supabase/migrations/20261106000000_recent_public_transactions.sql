-- Public "Live Transactions" feed for the landing page.
--
-- The transactions table is protected by RLS (users read their own rows, admins
-- read all), so an anonymous visitor can never see the feed. This SECURITY
-- DEFINER function exposes only a masked display name (from profiles.full_name),
-- type, amount and timestamp — never the user id, wallet address or transaction
-- hash.
CREATE OR REPLACE FUNCTION public.recent_public_transactions(row_limit integer DEFAULT 5)
RETURNS TABLE (
  id text,
  type text,
  amount numeric,
  created_at timestamptz,
  user_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id::text,
    t.type,
    t.amount,
    t.created_at,
    p.full_name AS user_name
  FROM public.transactions t
  LEFT JOIN public.profiles p ON p.id = t.user_id
  WHERE t.type IN ('deposit', 'withdrawal')
    AND t.status = 'completed'
    AND t.amount IS NOT NULL
    AND t.amount > 0
  ORDER BY t.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(row_limit, 5), 10));
$$;

REVOKE ALL ON FUNCTION public.recent_public_transactions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recent_public_transactions(integer) TO anon, authenticated;
