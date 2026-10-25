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
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
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
  const [submitting, setSubmitting] = useState(false);

  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);

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

  useEffect(() => {
    if (visible && uid) {
      fetchTickets();
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
      });
      if (error) throw error;
      toast.success("Ticket submitted", { description: "We will get back to you soon." });
      setSubject("");
      setMessage("");
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
      <DialogContent className="max-w-2xl">
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

        {tab === "mine" && (
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
                <div key={t.id} className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{t.subject}</div>
                    {statusBadge(t.status)}
                  </div>
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">{t.message}</div>
                  {t.admin_response && (
                    <div className="rounded-md bg-muted p-2 text-sm">
                      <div className="mb-1 text-xs font-semibold text-muted-foreground">Admin response</div>
                      <div className="whitespace-pre-wrap">{t.admin_response}</div>
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {new Date(t.created_at).toLocaleString()}
                    {t.resolved_at && ` · Resolved ${new Date(t.resolved_at).toLocaleString()}`}
                  </div>
                </div>
              ))
            )}
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={fetchTickets} disabled={loadingTickets}>
                Refresh
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default SupportModal;
