-- Rank referral bonuses to the referred user who produced them.
--
-- The dashboard's "Latest 5 Referrals" list needs to show the 10% bonus earned
-- from each referred user. public.transactions had no way to say *which*
-- referral a bonus came from (only the referrer in user_id), so this adds:
--
--   referred_user_id — the referred profile whose deposit generated the bonus
--   description      — human-readable note for admins/debugging
--
-- Older referral_bonus rows keep referred_user_id NULL (the original referred
-- user cannot be recovered reliably); the dashboard still counts them in the
-- Referral Bonus total and only shows a per-user amount when it is known.
--
-- Safe to re-run (idempotent). Run it in the Supabase SQL Editor.

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS referred_user_id uuid
    REFERENCES public.profiles (id) ON DELETE SET NULL;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS description text;

-- Per-referred-user lookups ("bonuses earned from this user").
CREATE INDEX IF NOT EXISTS transactions_referred_user_idx
  ON public.transactions (referred_user_id);

-- The dashboard reads every bonus row for the referrer.
CREATE INDEX IF NOT EXISTS transactions_referral_bonus_idx
  ON public.transactions (user_id, type, created_at DESC);

-- Backfill the unambiguous legacy rows: a referrer with exactly one
-- referral_bonus row and exactly one referred profile. Anything else stays
-- NULL because the association cannot be recovered reliably.
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
)
UPDATE public.transactions AS t
   SET referred_user_id = r.only_referral
  FROM single_bonus AS b
  JOIN referrals AS r
    ON r.referred_by = b.user_id
   AND r.referral_count = 1
 WHERE t.id = b.bonus_id;

COMMENT ON COLUMN public.transactions.referred_user_id IS
  'For type = referral_bonus: the referred profile whose deposit generated the bonus.';
COMMENT ON COLUMN public.transactions.description IS
  'Optional human-readable note, e.g. "10% referral bonus from Jane Doe''s $60.00 deposit".';
