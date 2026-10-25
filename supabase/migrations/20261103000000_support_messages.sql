-- support_messages: threaded chat replies for support tickets.
CREATE TABLE IF NOT EXISTS public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_messages_ticket_id_idx
  ON public.support_messages (ticket_id, created_at);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Ticket owner and admins can read messages.
DROP POLICY IF EXISTS "support_messages_select" ON public.support_messages;
CREATE POLICY "support_messages_select"
  ON public.support_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_id AND t.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- Ticket owner and admins can insert messages as themselves.
DROP POLICY IF EXISTS "support_messages_insert" ON public.support_messages;
CREATE POLICY "support_messages_insert"
  ON public.support_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id = ticket_id AND t.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.is_admin = true
      )
    )
  );
