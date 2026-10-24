-- Wallet Management + multi-wallet withdrawal redesign
-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- 1) profiles.saved_wallets: JSONB store of saved crypto addresses keyed by
--    network, e.g. { bep20: "0x...", solana: "...", trc20: "..." }.
-- 2) profiles.default_wallet_type: the user's preferred default network
--    (bep20 | solana | trc20) used to pre-fill the withdrawal form.

-- 1) Saved wallets (JSONB)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_wallets jsonb NULL DEFAULT '{}'::jsonb;

-- 2) Default wallet type
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_wallet_type text NULL;

-- Constrain the default wallet type to the supported networks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_default_wallet_type_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_default_wallet_type_check
      CHECK (default_wallet_type IN ('bep20', 'solana', 'trc20'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.saved_wallets IS 'User-saved crypto addresses keyed by network: { bep20, solana, trc20 }.';
COMMENT ON COLUMN public.profiles.default_wallet_type IS 'Preferred default withdrawal network: bep20, solana, or trc20.';
