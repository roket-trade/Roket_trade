-- 0004_payment_user_link.sql
-- Link payments to the submitting user and allow authenticated inserts
-- where user_id = auth.uid(). Idempotent.

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS transactions_user_id_idx ON public.transactions (user_id);
CREATE INDEX IF NOT EXISTS payments_user_id_idx ON public.payments (user_id);

GRANT SELECT, INSERT ON public.transactions TO authenticated;
GRANT SELECT, INSERT ON public.payments TO authenticated;

-- Authenticated users may insert their own pending payments.
DROP POLICY IF EXISTS "Users can submit their own pending transaction" ON public.transactions;
CREATE POLICY "Users can submit their own pending transaction" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND plan_name IN ('Plan 1','Plan 2','Plan 3','Plan 4')
    AND deposit_amount IN (60,120,180,250)
    AND ((network = 'BEP20' AND wallet_address = '0x35aec7E35F65ea227e49fDd321709D52Ada389E4')
      OR (network = 'SOL' AND wallet_address = '3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ'))
  );

DROP POLICY IF EXISTS "Users can view their own transactions" ON public.transactions;
CREATE POLICY "Users can view their own transactions" ON public.transactions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can submit their own pending payment" ON public.payments;
CREATE POLICY "Users can submit their own pending payment" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending'
    AND plan_name IN ('Plan 1','Plan 2','Plan 3','Plan 4')
    AND deposit_amount IN (60,120,180,250)
    AND ((network = 'BEP20' AND wallet_address = '0x35aec7E35F65ea227e49fDd321709D52Ada389E4')
      OR (network = 'SOL' AND wallet_address = '3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ'))
  );

DROP POLICY IF EXISTS "Users can view their own payments" ON public.payments;
CREATE POLICY "Users can view their own payments" ON public.payments
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
