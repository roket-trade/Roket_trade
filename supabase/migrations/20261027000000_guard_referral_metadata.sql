-- Guard the signup referral capture trigger against short codes.
--
-- profiles.referred_by stores the referrer's user id. The signup form also
-- sends the raw short code in auth metadata (both `referral_code` and
-- `referred_by`) so public.handle_new_user() can resolve it server-side.
-- handle_referral_on_profile() previously copied any metadata `referred_by`
-- value straight into profiles.referred_by. On deployments where that column
-- is uuid-typed this raised:
--   ERROR: invalid input syntax for type uuid: "FRIEND1"
-- and aborted the whole signup.
--
-- This migration makes the capture trigger copy only UUID-shaped values.
-- Short-code resolution stays in handle_new_user(), which reads
-- metadata.referral_code. Safe to re-run (idempotent).

CREATE OR REPLACE FUNCTION public.handle_referral_on_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_referred_by text;
BEGIN
  IF NEW.referred_by IS NULL THEN
    SELECT (raw_user_meta_data ->> 'referred_by')
      INTO meta_referred_by
      FROM auth.users
      WHERE id = NEW.id;

    -- Only a resolved referrer id may land in the column; a short code would
    -- fail the uuid cast (or store an unusable value on a text column).
    IF meta_referred_by
       ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      NEW.referred_by := meta_referred_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
