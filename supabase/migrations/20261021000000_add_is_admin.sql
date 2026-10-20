-- Admin role migration for Roket_trade
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1) Add is_admin flag to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 2) Helpful index for admin lookups
CREATE INDEX IF NOT EXISTS profiles_is_admin_idx ON public.profiles (is_admin);

-- 3) Promote your own account to admin (REPLACE with your login email)
-- UPDATE public.profiles SET is_admin = true WHERE email = 'you@example.com';

-- 4) RLS: allow admins to read all profiles / transactions
-- (Assumes RLS is enabled. Adjust to your existing policies if needed.)

-- Profiles: admins can view every profile (needed for KYC queue + email lookup)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Admins can read all profiles'
  ) THEN
    CREATE POLICY "Admins can read all profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
    );
  END IF;
END $$;

-- Profiles: admins can update kyc_status + balances (for approvals)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Admins can update profiles'
  ) THEN
    CREATE POLICY "Admins can update profiles"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
    );
  END IF;
END $$;

-- Transactions: admins can read + update all transactions (approval queues)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactions' AND policyname = 'Admins can read all transactions'
  ) THEN
    CREATE POLICY "Admins can read all transactions"
    ON public.transactions FOR SELECT
    TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactions' AND policyname = 'Admins can update transactions'
  ) THEN
    CREATE POLICY "Admins can update transactions"
    ON public.transactions FOR UPDATE
    TO authenticated
    USING (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transactions' AND policyname = 'Admins can insert transactions'
  ) THEN
    CREATE POLICY "Admins can insert transactions"
    ON public.transactions FOR INSERT
    TO authenticated
    WITH CHECK (
      EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_admin = true)
    );
  END IF;
END $$;
