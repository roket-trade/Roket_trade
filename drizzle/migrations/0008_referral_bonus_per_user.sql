-- 0008_referral_bonus_per_user.sql
-- Links each referral bonus to the referred user who produced it.
-- Mirrors supabase/migrations/20261024000000_referral_bonus_per_user.sql.
-- All statements are idempotent so re-applying the migration is safe.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS referred_user_id uuid
    REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS description text;

CREATE INDEX IF NOT EXISTS transactions_referred_user_idx
  ON public.transactions (referred_user_id);

CREATE INDEX IF NOT EXISTS transactions_referral_bonus_idx
  ON public.transactions (user_id, type, created_at DESC);

-- Backfill only the unambiguous legacy rows: a referrer with exactly one
-- referral_bonus row and exactly one referred profile.
WITH unlinked AS (
  SELECT t.id, t.user_id
    FROM public.transactions AS t
   WHERE t.type = 'referral_bonus'
     AND t.referred_user_id IS NULL
     AND t.user_id IS NOT NULL
),
single_bonus AS (
  SELECT u.id AS bonus_id, u.user_id
    FROM unlinked AS u
   WHERE (SELECT count(*) FROM unlinked AS x WHERE x.user_id = u.user_id) = 1
),
referrals AS (
  SELECT p.referred_by,
         count(*) AS referral_count,
         min(p.id::text)::uuid AS only_referral
    FROM public.profiles AS p
   WHERE p.referred_by IS NOT NULL
   GROUP BY p.referred_by
),
mapping AS (
  SELECT b.bonus_id, r.only_referral
    FROM single_bonus AS b
    JOIN referrals AS r
      -- profiles.referred_by is text in the live schema while
      -- transactions.user_id is uuid, and text = uuid has no operator
      -- (SQLSTATE 42883). Cast both sides to text so this works whether
      -- referred_by is text or uuid.
      ON r.referred_by::text = b.user_id::text
     AND r.referral_count = 1
)
UPDATE public.transactions AS t
   SET referred_user_id = m.only_referral
  FROM mapping AS m
 WHERE t.id = m.bonus_id;
