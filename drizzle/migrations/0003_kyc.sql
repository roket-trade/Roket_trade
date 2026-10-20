-- 0003_kyc.sql
-- KYC fields on profiles plus a public storage bucket for ID card images.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id_card_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kyc_status text;

UPDATE public.profiles
SET kyc_status = 'unverified'
WHERE kyc_status IS NULL OR btrim(kyc_status) = '';

INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Users can upload their own KYC documents" ON storage.objects;
CREATE POLICY "Users can upload their own KYC documents"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can update their own KYC documents" ON storage.objects;
CREATE POLICY "Users can update their own KYC documents"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND split_part(name, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'kyc-documents'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Public can read KYC documents" ON storage.objects;
CREATE POLICY "Public can read KYC documents"
  ON storage.objects
  FOR SELECT
  TO public
  USING (bucket_id = 'kyc-documents');
