-- Remove deposit principal from user balances.
--
-- Deposits activate a plan but must never become withdrawable balance. Earlier
-- flows credited the deposit amount to profiles.main_balance on approval, so
-- existing rows can still contain that principal. Subtract the completed deposit
-- totals from main_balance, keeping any earnings that were added afterwards.
--
-- Welcome bonus backfill: grant the one-time $2.00 bonus to verified users who
-- never received it (welcome_bonus_claimed IS NOT TRUE and no welcome_bonus
-- transaction exists yet).

UPDATE public.profiles p
SET main_balance = GREATEST(
  0,
  COALESCE(p.main_balance, 0) - COALESCE((
    SELECT SUM(t.amount)
    FROM public.transactions t
    WHERE t.user_id = p.id
      AND t.type = 'deposit'
      AND t.status = 'completed'
  ), 0)
);

INSERT INTO public.transactions (user_id, type, amount, status, description)
SELECT p.id, 'welcome_bonus', 2, 'completed', 'Welcome Bonus for completing KYC'
FROM public.profiles p
WHERE p.kyc_status = 'verified'
  AND COALESCE(p.welcome_bonus_claimed, false) IS NOT TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = p.id AND t.type = 'welcome_bonus'
  );

UPDATE public.profiles p
SET extra_balance = COALESCE(p.extra_balance, 0) + 2,
    welcome_bonus_claimed = true
WHERE p.kyc_status = 'verified'
  AND COALESCE(p.welcome_bonus_claimed, false) IS NOT TRUE
  AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.user_id = p.id AND t.type = 'welcome_bonus'
  );
