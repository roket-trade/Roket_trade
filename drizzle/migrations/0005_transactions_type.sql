-- 0005_transactions_type.sql
-- Live DB has public.transactions.type NOT NULL, but local migrations never
-- created it. Backfill it idempotently so checkout inserts succeed.

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS type text;

-- Existing rows must satisfy NOT NULL before we enforce it.
UPDATE public.transactions SET type = 'deposit' WHERE type IS NULL OR btrim(type) = '';
UPDATE public.payments SET type = 'deposit' WHERE type IS NULL OR btrim(type) = '';

ALTER TABLE public.transactions ALTER COLUMN type SET DEFAULT 'deposit';
ALTER TABLE public.payments ALTER COLUMN type SET DEFAULT 'deposit';

ALTER TABLE public.transactions ALTER COLUMN type SET NOT NULL;
ALTER TABLE public.payments ALTER COLUMN type SET NOT NULL;

-- Keep the authenticated INSERT policies in sync with the required type.
DROP POLICY IF EXISTS "Users can submit their own pending transaction" ON public.transactions;
CREATE POLICY "Users can submit their own pending transaction" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND type = 'deposit'
    AND status = 'pending'
    AND plan_name IN ('Plan 1','Plan 2','Plan 3','Plan 4')
    AND deposit_amount IN (60,120,180,250)
    AND ((network = 'BEP20' AND wallet_address = '0x35aec7E35F65ea227e49fDd321709D52Ada389E4')
      OR (network = 'SOL' AND wallet_address = '3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ'))
  );

DROP POLICY IF EXISTS "Users can submit their own pending payment" ON public.payments;
CREATE POLICY "Users can submit their own pending payment" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND type = 'deposit'
    AND status = 'pending'
    AND plan_name IN ('Plan 1','Plan 2','Plan 3','Plan 4')
    AND deposit_amount IN (60,120,180,250)
    AND ((network = 'BEP20' AND wallet_address = '0x35aec7E35F65ea227e49fDd321709D52Ada389E4')
      OR (network = 'SOL' AND wallet_address = '3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ'))
  );
