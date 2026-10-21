import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import logo from "@/assets/roket-logo.png.asset.json";
import { RequireAdmin } from "@/components/RequireAdmin";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin Panel — Roket" },
      { name: "description", content: "Manage deposits, withdrawals, and KYC." },
    ],
  }),
  component: Admin,
});

type Tx = {
  id: string;
  user_id: string | null;
  type: string;
  amount: number;
  deposit_amount: number | null;
  plan_name: string | null;
  network: string | null;
  wallet_address: string | null;
  tx_hash: string | null;
  status: string;
  created_at: string;
};

type KycUser = {
  id: string;
  full_name: string;
  kyc_status: string | null;
  id_card_url: string | null;
  created_at: string;
};

type Tab = "deposits" | "withdrawals" | "kyc";
const money = (n: number) => Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const short = (s: string | null, n = 18) => (!s ? "—" : s.length > n ? `${s.slice(0, n)}…` : s);
function Admin() {
  return (
    <RequireAdmin>
      <AdminContent />
    </RequireAdmin>
  );
}

function AdminContent() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("deposits");
  const [deposits, setDeposits] = useState<Tx[]>([]);
  const [withdrawals, setWithdrawals] = useState<Tx[]>([]);
  const [kycUsers, setKycUsers] = useState<KycUser[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // profiles has no email column, so nothing here selects or embeds it
      // (that used to raise PGRST204 / PGRST200). Emails are resolved from
      // auth.users afterwards through the admin_user_emails() RPC.
      const txCols =
        "id,user_id,type,amount,deposit_amount,plan_name,network,wallet_address,tx_hash,status,created_at";
      const [dep, wd, kyc] = await Promise.all([
        supabase.from("transactions").select(txCols).eq("type", "deposit").eq("status", "pending").order("created_at"),
        supabase.from("transactions").select(txCols).eq("type", "withdrawal").eq("status", "pending").order("created_at"),
        supabase.from("profiles").select("id,full_name,kyc_status,id_card_url,created_at").eq("kyc_status", "pending").order("created_at"),
      ]);
      if (dep.error) {
        console.error("[admin] deposits fetch error:", dep.error.code, dep.error.message, dep.error.details, dep.error.hint);
      }
      if (wd.error) {
        console.error("[admin] withdrawals fetch error:", wd.error.code, wd.error.message, wd.error.details, wd.error.hint);
      }
      if (kyc.error) {
        console.error("[admin] KYC fetch error:", kyc.error.code, kyc.error.message, kyc.error.details, kyc.error.hint);
      }
      const firstErr = dep.error ?? wd.error ?? kyc.error;
      if (firstErr) throw firstErr;

      const deps = (dep.data ?? []) as Tx[];
      const wds = (wd.data ?? []) as Tx[];
      const kycRows = (kyc.data ?? []) as KycUser[];
      setDeposits(deps);
      setWithdrawals(wds);
      setKycUsers(kycRows);

      // One RPC call covers every row on the page (deposits, withdrawals and
      // KYC), so the panel needs a single extra round-trip and no per-row query.
      const ids = [
        ...new Set(
          [...deps, ...wds]
            .map((tx) => tx.user_id)
            .concat(kycRows.map((u) => u.id))
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      if (ids.length === 0) {
        setEmails({});
        return;
      }

      const { data: emailRows, error: emailErr } = await supabase.rpc("admin_user_emails", { ids });
      if (emailErr) {
        console.error("[admin] admin_user_emails RPC failed:", emailErr.code, emailErr.message, emailErr.details, emailErr.hint);
        setEmails({});
      } else {
        const map: Record<string, string> = {};
        for (const row of emailRows ?? []) {
          if (row.email) map[row.id] = row.email;
        }
        setEmails(map);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load admin data.";
      console.error("[admin] load failed:", err);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  const approveDeposit = async (tx: Tx) => {
    if (!tx.user_id) return toast.error("Transaction has no user.");
    setBusyId(tx.id);
    try {
      const credit = Number(tx.deposit_amount ?? tx.amount);
      if (!Number.isFinite(credit) || credit <= 0) throw new Error("Invalid deposit amount.");
      const { error: txErr } = await supabase.from("transactions").update({ status: "completed" }).eq("id", tx.id);
      if (txErr) throw txErr;
      const { data: up, error: uErr } = await supabase.from("profiles").select("id,main_balance,referred_by").eq("id", tx.user_id).maybeSingle();
      if (uErr) throw uErr;
      if (!up) throw new Error("User profile not found.");
      const nextBal = Math.round((Number(up.main_balance ?? 0) + credit) * 100) / 100;
      const { error: bErr } = await supabase.from("profiles").update({ main_balance: nextBal }).eq("id", tx.user_id);
      if (bErr) throw bErr;
      const refId = (up as { referred_by?: string | null }).referred_by;
      if (refId) {
        const bonus = Math.round(credit * 0.1 * 100) / 100;
        const { data: ref } = await supabase.from("profiles").select("id,main_balance").eq("id", refId).maybeSingle();
        if (ref) {
          const nextRef = Math.round((Number(ref.main_balance ?? 0) + bonus) * 100) / 100;
          await supabase.from("profiles").update({ main_balance: nextRef }).eq("id", refId);
          await supabase.from("transactions").insert({ user_id: refId, type: "referral_bonus", amount: bonus, status: "completed" });
          toast.success(`Approved. Referrer earned ${money(bonus)}.`);
        } else toast.success("Approved (referrer not found).");
      } else toast.success("Deposit approved.");
      setDeposits((d) => d.filter((t) => t.id !== tx.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't approve deposit.");
    } finally {
      setBusyId(null);
    }
  };

  const rejectDeposit = async (tx: Tx) => {
    setBusyId(tx.id);
    try {
      const { error } = await supabase.from("transactions").update({ status: "rejected" }).eq("id", tx.id);
      if (error) throw error;
      setDeposits((d) => d.filter((t) => t.id !== tx.id));
      toast.success("Deposit rejected.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reject deposit.");
    } finally {
      setBusyId(null);
    }
  };

  const approveWithdrawal = async (tx: Tx) => {
    setBusyId(tx.id);
    try {
      const { error } = await supabase.from("transactions").update({ status: "completed" }).eq("id", tx.id);
      if (error) throw error;
      setWithdrawals((w) => w.filter((t) => t.id !== tx.id));
      toast.success("Withdrawal completed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't approve withdrawal.");
    } finally {
      setBusyId(null);
    }
  };

  const rejectWithdrawal = async (tx: Tx) => {
    if (!tx.user_id) return toast.error("Transaction has no user.");
    setBusyId(tx.id);
    try {
      const refund = Math.abs(Number(tx.amount));
      const { data: up, error: uErr } = await supabase.from("profiles").select("id,main_balance,extra_balance").eq("id", tx.user_id).maybeSingle();
      if (uErr) throw uErr;
      if (!up) throw new Error("User profile not found.");
      const toExtra = (tx.plan_name ?? "").toLowerCase().includes("extra");
      const patch = toExtra
        ? { extra_balance: Math.round((Number(up.extra_balance ?? 0) + refund) * 100) / 100 }
        : { main_balance: Math.round((Number(up.main_balance ?? 0) + refund) * 100) / 100 };
      const { error: bErr } = await supabase.from("profiles").update(patch).eq("id", tx.user_id);
      if (bErr) throw bErr;
      const { error: tErr } = await supabase.from("transactions").update({ status: "rejected" }).eq("id", tx.id);
      if (tErr) throw tErr;
      setWithdrawals((w) => w.filter((t) => t.id !== tx.id));
      toast.success(`Rejected. ${money(refund)} refunded.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reject withdrawal.");
    } finally {
      setBusyId(null);
    }
  };

  const setKyc = async (userId: string, status: "verified" | "rejected") => {
    setBusyId(userId);
    try {
      const { error } = await supabase.from("profiles").update({ kyc_status: status }).eq("id", userId);
      if (error) throw error;
      setKycUsers((u) => u.filter((x) => x.id !== userId));
      toast.success(`KYC ${status}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update KYC.");
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "deposits", label: "Pending Deposits", count: deposits.length },
    { id: "withdrawals", label: "Pending Withdrawals", count: withdrawals.length },
    { id: "kyc", label: "KYC Verifications", count: kycUsers.length },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/"><img src={logo.url} alt="Roket" className="h-9" /></Link>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-bold uppercase tracking-widest text-primary">Admin</span>
            <Link to="/dashboard" className="hidden rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:block">Dashboard</Link>
            <button type="button" onClick={signOut} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:border-primary hover:text-primary">Log out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Admin Panel</p>
        <h1 className="mt-2 font-display text-4xl font-bold">Manage the platform</h1>
        <p className="mt-2 text-sm text-muted-foreground">Approve deposits (pays 10% referral bonus), review withdrawals, verify KYC.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={tab === t.id ? "rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-glow" : "rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground"}>
              {t.label} ({t.count})
            </button>
          ))}
          <button type="button" onClick={() => void load()} className="ml-auto rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground">Refresh</button>
        </div>
        {loading ? (
          <div className="flex min-h-[40vh] items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
        ) : (<div className="mt-6">{tab === "deposits" && (
          <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3">User</th><th className="px-4 py-3">Plan</th><th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Tx Hash</th><th className="px-4 py-3">Network</th><th className="px-4 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {deposits.length === 0 && (<tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No pending deposits.</td></tr>)}
                {deposits.map((tx) => (
                  <tr key={tx.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3 font-medium">{tx.user_id ? emails[tx.user_id] ?? short(tx.user_id, 10) : "—"}</td>
                    <td className="px-4 py-3">{tx.plan_name ?? "—"}</td>
                    <td className="px-4 py-3 font-semibold text-primary">{money(Number(tx.deposit_amount ?? tx.amount))}</td>
                    <td className="px-4 py-3 font-mono text-xs" title={tx.tx_hash ?? ""}>{short(tx.tx_hash, 22)}</td>
                    <td className="px-4 py-3">{tx.network ?? "—"}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      <button type="button" disabled={busyId === tx.id} onClick={() => void approveDeposit(tx)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busyId === tx.id ? "…" : "Approve"}</button>
                      <button type="button" disabled={busyId === tx.id} onClick={() => void rejectDeposit(tx)} className="rounded-lg bg-destructive/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-destructive disabled:opacity-50">Reject</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )}
        {tab === "withdrawals" && (
          <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3">User</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Crypto Address</th><th className="px-4 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {withdrawals.length === 0 && (<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No pending withdrawals.</td></tr>)}
                {withdrawals.map((tx) => (
                  <tr key={tx.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3 font-medium">{tx.user_id ? emails[tx.user_id] ?? short(tx.user_id, 10) : "—"}</td>
                    <td className="px-4 py-3 font-semibold text-primary">{money(Math.abs(Number(tx.amount)))}</td>
                    <td className="max-w-[260px] truncate px-4 py-3 font-mono text-xs" title={tx.wallet_address ?? ""}>{tx.wallet_address ?? "—"}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      <button type="button" disabled={busyId === tx.id} onClick={() => void approveWithdrawal(tx)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busyId === tx.id ? "…" : "Approve"}</button>
                      <button type="button" disabled={busyId === tx.id} onClick={() => void rejectWithdrawal(tx)} className="rounded-lg bg-destructive/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-destructive disabled:opacity-50">Reject + Refund</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )}
        {tab === "kyc" && (
          <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3">User</th><th className="px-4 py-3">Full Name</th><th className="px-4 py-3">ID Card</th><th className="px-4 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {kycUsers.length === 0 && (<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No pending KYC.</td></tr>)}
                {kycUsers.map((u) => (
                  <tr key={u.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3 font-medium">{emails[u.id] ?? short(u.id, 10)}</td>
                    <td className="px-4 py-3">{u.full_name}</td>
                    <td className="px-4 py-3">{u.id_card_url ? (<a href={u.id_card_url} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">View ID card</a>) : (<span className="text-muted-foreground">No file</span>)}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      <button type="button" disabled={busyId === u.id} onClick={() => void setKyc(u.id, "verified")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busyId === u.id ? "…" : "Verify"}</button>
                      <button type="button" disabled={busyId === u.id} onClick={() => void setKyc(u.id, "rejected")} className="rounded-lg bg-destructive/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-destructive disabled:opacity-50">Reject</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )}
        </div>
        )}
      </main>
    </div>
  );
}

