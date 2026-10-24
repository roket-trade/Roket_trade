-- 0010_wallet_management.sql
-- Mirrors supabase/migrations/20261026000000_wallet_management.sql.
-- All statements are idempotent so re-applying the migration is safe.

-- 1) Saved wallets (JSONB)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_wallets jsonb NULL DEFAULT '{}'::jsonb;

-- 2) Default wallet type
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_wallet_type text NULL;

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
