import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/AuthProvider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Plus, Ticket, Clock, CheckCircle2, MessageSquare } from "lucide-react";

type TicketRow = {
  id: string;
  user_id: string | null;
  subject: string;
  message: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
  resolved_at: string | null;
  category: string | null;
  image_url: string | null;
};

type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  message: string;
  created_at: string;
};

type Props = {
  open?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
  userId?: string;
};


export function SupportModal({ open, isOpen, onOpenChange, onClose, userId }: Props) {
  const visible = open ?? isOpen ?? false;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (!v) onClose?.();
  };
  const { user } = useAuth();
  const uid = userId ?? user?.id;

  const [tab, setTab] = useState<"new" | "mine">("new");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("general");
  const [imageUrl, setImageUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

  const [selectedTicket, setSelectedTicket] = useState<TicketRow | null>(null);
  const [ticketMessages, setTicketMessages] = useState<SupportMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [sendingReply, setSendingReply] = useState(false);

  const fetchTickets = async () => {
    if (!uid) return;
    setLoadingTickets(true);
    try {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("user_id", uid)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setTickets((data ?? []) as TicketRow[]);
    } catch (e: any) {
      toast.error("Failed to load tickets", { description: e?.message ?? "Unknown error" });
    } finally {
      setLoadingTickets(false);
    }
  };

  const fetchTicketMessages = async (ticketId: string) => {
    setMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setTicketMessages((data ?? []) as SupportMessage[]);
    } catch (e: any) {
      toast.error("Failed to load messages", { description: e?.message ?? "Unknown error" });
    } finally {
      setMessagesLoading(false);
    }
  };

  const openTicketChat = (ticket: TicketRow) => {
    setSelectedTicket(ticket);
    setReplyDraft("");
    setTicketMessages([]);
    fetchTicketMessages(ticket.id);
  };

  const sendReply = async () => {
    if (!selectedTicket || !uid) return;
    const m = replyDraft.trim();
    if (!m) return;
    setSendingReply(true);
    try {
      const { error } = await supabase.from("support_messages").insert({
        ticket_id: selectedTicket.id,
        sender_id: uid,
        message: m,
      });
      if (error) throw error;
      setReplyDraft("");
      await fetchTicketMessages(selectedTicket.id);
    } catch (e: any) {
      toast.error("Failed to send reply", { description: e?.message ?? "Unknown error" });
    } finally {
      setSendingReply(false);
    }
  };

  useEffect(() => {
    if (visible && uid) {
      fetchTickets();
    }
    if (!visible) {
      setSelectedTicket(null);
      setTicketMessages([]);
      setReplyDraft("");
    }
  }, [visible, uid]);

  const submitTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uid) {
      toast.error("Not signed in", { description: "Please sign in to submit a ticket." });
      return;
    }
    const s = subject.trim();
    const m = message.trim();
    if (!s || !m) {
      toast.error("Missing fields", { description: "Subject and message are required." });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("support_tickets").insert({
        user_id: uid,
        subject: s,
        message: m,
        status: "open",
         category,
         image_url: imageUrl.trim() || null,
      });
      if (error) throw error;
      toast.success("Ticket submitted", { description: "We will get back to you soon." });
      setSubject("");
      setMessage("");
       setCategory("general");
       setImageUrl("");
      setTab("mine");
      fetchTickets();
    } catch (e: any) {
      toast.error("Submission failed", { description: e?.message ?? "Unknown error" });
    } finally {
      setSubmitting(false);
    }
  };

  const statusBadge = (status: string) => {
    const lower = (status || "").toLowerCase();
    if (lower === "resolved" || lower === "closed") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600">
          <CheckCircle2 className="h-3 w-3" /> {status}
        </span>
      );
    }
    if (lower === "in_progress" || lower === "in progress") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600">
          <Clock className="h-3 w-3" /> {status}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-600">
        <Ticket className="h-3 w-3" /> {status || "open"}
      </span>
    );
  };

  return (
    <Dialog open={visible} onOpenChange={setOpen}>
      <DialogContent className="z-[10000] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Support</DialogTitle>
          <DialogDescription>Submit a new ticket or review your existing ones.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-2">
          <button
            type="button"
            onClick={() => setTab("new")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === "new" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <span className="inline-flex items-center gap-1"><Plus className="h-4 w-4" /> New Ticket</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("mine")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${tab === "mine" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <span className="inline-flex items-center gap-1"><MessageSquare className="h-4 w-4" /> My Tickets</span>
          </button>
        </div>

        {tab === "new" && (
          <form onSubmit={submitTicket} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Subject</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Briefly describe your issue"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="technical">Technical</option>
                <option value="account">Account</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Image URL (optional)</label>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Message</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Provide details so we can help you faster"
                rows={5}
              />
            </div>
            <div className="flex justify-end">
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Ticket
              </Button>
            </div>
          </form>
        )}

                {tab === "mine" && !selectedTicket && (
          <div className="space-y-3 pt-2 max-h-[60vh] overflow-auto">
            {loadingTickets ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : tickets.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                You have not submitted any tickets yet.
              </div>
            ) : (
              tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTicketChat(t)}
                  className="w-full rounded-lg border p-3 space-y-2 text-left hover:bg-muted/50 transition"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{t.subject}</div>
                    {statusBadge(t.status)}
                  </div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-2">{t.message}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleString()}
                    {t.resolved_at && ` · Resolved ${new Date(t.resolved_at).toLocaleString()}`}
                  </div>
                </button>
              ))
            )}
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={fetchTickets} disabled={loadingTickets}>
                Refresh
              </Button>
            </div>
          </div>
        )}

        {tab === "mine" && selectedTicket && (
          <div className="flex flex-col gap-3 pt-2 max-h-[60vh]">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setSelectedTicket(null)}>
                ← Back
              </Button>
              <div className="text-sm font-medium">{selectedTicket.subject}</div>
              {statusBadge(selectedTicket.status)}
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3 min-h-[200px]">
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-lg bg-background border px-3 py-2 text-sm">
                  <div className="whitespace-pre-wrap">{selectedTicket.message}</div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {new Date(selectedTicket.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
              {messagesLoading ? (
                <div className="flex items-center justify-center py-6 text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                ticketMessages.map((msg) => {
                  const isUser = msg.sender_id === uid;
                  return (
                    <div key={msg.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isUser ? "bg-primary text-primary-foreground" : "bg-background border"}`}>
                        <div className="whitespace-pre-wrap">{msg.message}</div>
                        <div className={`mt-1 text-[10px] ${isUser ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                          {new Date(msg.created_at).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex gap-2">
              <Textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                placeholder="Type a reply..."
                rows={2}
              />
              <Button onClick={() => void sendReply()} disabled={sendingReply || !replyDraft.trim()} className="self-end">
                {sendingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send"}
              </Button>
            </div>
          </div>
        )}

      </DialogContent>
    </Dialog>
  );
}

export default SupportModal;
