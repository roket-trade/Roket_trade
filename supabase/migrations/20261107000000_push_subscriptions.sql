-- Push subscriptions: the OneSignal subscription ("player") id per browser.
--
-- Why this exists: targeting a push by OneSignal external_id only works after
-- OneSignal.login(user.id) has attached that alias to the subscription. When it
-- silently does not, the REST API answers 200 with `recipients: 0`. Storing the
-- subscription id lets send-push target `include_subscription_ids` directly,
-- which needs no alias at all.
--
-- Safe to re-run (idempotent). Run in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  -- OneSignal subscription id. Unique per browser/device, never reused.
  subscription_id text NOT NULL UNIQUE,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_id_idx
  ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- A signed-in user may manage only their own devices, and only under their own
-- user id (so nobody can register a subscription against another account).
DROP POLICY IF EXISTS "Users can read their push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can read their push subscriptions"
  ON public.push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Users can register their push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can register their push subscriptions"
  ON public.push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can update their push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can update their push subscriptions"
  ON public.push_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete their push subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can delete their push subscriptions"
  ON public.push_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
