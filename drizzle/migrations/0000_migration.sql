CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_name text NOT NULL,
  deposit_amount numeric(12,2) NOT NULL,
  network text NOT NULL CHECK (network IN ('BEP20','SOL')),
  wallet_address text NOT NULL,
  tx_hash text NOT NULL UNIQUE CHECK (char_length(tx_hash) BETWEEN 20 AND 120),
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.payments TO anon, authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can submit a pending payment" ON public.payments
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    status = 'pending'
    AND plan_name IN ('Plan 1','Plan 2','Plan 3','Plan 4')
    AND deposit_amount IN (60,120,180,250)
    AND ((network = 'BEP20' AND wallet_address = '0x35aec7E35F65ea227e49fDd321709D52Ada389E4')
      OR (network = 'SOL' AND wallet_address = '3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ'))
  );