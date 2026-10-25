import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { RequireAdmin } from "@/components/RequireAdmin";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";

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

type AdminUser = {
  id: string;
  full_name: string | null;
  main_balance: number | null;
  extra_balance: number | null;
  kyc_status: string | null;
  plan_name: string | null;
  plan_started_at: string | null;
  plan_expires_at: string | null;
  is_admin: boolean;
  is_suspended: boolean;
  last_withdraw_at: string | null;
  created_at: string;
};

type SupportTicket = {
  id: string;
  user_id: string | null;
  subject: string;
  message: string;
  status: string;
  created_at: string;
  admin_reply?: string | null;
  category?: string | null;
  image_url?: string | null;
};

type Tab = "deposits" | "users" | "withdrawals" | "kyc" | "support";

type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  message: string;
  created_at: string;
};



// Money EARNED per user, aggregated from transactions — deposits are never part
// of these figures. `adjustment` is the manual correction an admin can make
// from the Edit modal and is already folded into totalEarned/availableBalance.
type UserAggregate = {
  totalEarned: number;
  totalWithdrawn: number;
  availableBalance: number;
  referralCount: number;
  adjustment: number;
};

const EMPTY_AGGREGATE: UserAggregate = {
  totalEarned: 0,
  totalWithdrawn: 0,
  availableBalance: 0,
  referralCount: 0,
  adjustment: 0,
};

const EARNINGS_TYPES = ["daily_profit", "ad_earning", "referral_bonus"] as const;
const TX_COLS =
  "id,user_id,type,amount,deposit_amount,plan_name,network,wallet_address,tx_hash,status,created_at";

const USER_COLS =
  "id,full_name,main_balance,extra_balance,kyc_status,plan_name,plan_started_at,plan_expires_at,is_admin,last_withdraw_at,created_at";
const PLANS = ["Plan 1", "Plan 2", "Plan 3", "Plan 4"] as const;
const KYC_STATUSES = ["unverified", "pending", "verified", "rejected"] as const;

const money = (n: number) => Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const short = (s: string | null, n = 18) => (!s ? "—" : s.length > n ? `${s.slice(0, n)}…` : s);
const round2 = (n: number) => Math.round(n * 100) / 100;
const asNumber = (value: unknown, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

// PostgREST reports a select on an unknown column as 42703 (and an unknown
// column in a mutation payload as PGRST204). Tolerating both lets the panel
// keep working before the is_suspended migration has run.
const isMissingSuspendedColumn = (err: { code?: string; message?: string } | null) =>
  Boolean(err) && /is_suspended/i.test(err?.message ?? "");

async function fetchAdminUsers(): Promise<AdminUser[]> {
  const withFlag = await supabase
    .from("profiles")
    .select(`${USER_COLS},is_suspended`)
    .order("created_at", { ascending: false });
  if (!withFlag.error) return (withFlag.data ?? []) as unknown as AdminUser[];
  if (!isMissingSuspendedColumn(withFlag.error)) throw withFlag.error;

  const withoutFlag = await supabase
    .from("profiles")
    .select(USER_COLS)
    .order("created_at", { ascending: false });
  if (withoutFlag.error) throw withoutFlag.error;
  return ((withoutFlag.data ?? []) as unknown as Omit<AdminUser, "is_suspended">[]).map((u) => ({
    ...u,
    is_suspended: false,
  }));
}

// PostgREST hands numeric aggregates back as numbers, but a plain SQL function
// can ship numeric as a string, so normalise both shapes.
const aggregateRowsToMap = (rows: unknown): Record<string, UserAggregate> => {
  const map: Record<string, UserAggregate> = {};
  if (!Array.isArray(rows)) return map;
  for (const raw of rows) {
    const row = raw as Record<string, unknown> | null;
    const id = typeof row?.["user_id"] === "string" ? row["user_id"] : null;
    if (!id) continue;
    map[id] = {
      totalEarned: round2(asNumber(row?.["total_earned"])),
      totalWithdrawn: round2(asNumber(row?.["total_withdrawn"])),
      availableBalance: round2(asNumber(row?.["available_balance"])),
      referralCount: Math.trunc(asNumber(row?.["referral_count"])),
      adjustment: round2(asNumber(row?.["earnings_adjustment"])),
    };
  }
  return map;
};

// Fallback for deployments that have not run the aggregate migration yet: two
// batched queries for the whole page (never one query per user).
async function fetchAggregatesFallback(): Promise<Record<string, UserAggregate>> {
  const [txRes, refRes] = await Promise.all([
    supabase
      .from("transactions")
      .select("user_id,type,amount,status")
      .in("type", [...EARNINGS_TYPES, "withdrawal"]),
    supabase.from("profiles").select("referred_by"),
  ]);
  if (txRes.error) throw txRes.error;
  if (refRes.error) throw refRes.error;

  const map: Record<string, UserAggregate> = {};
  const ensure = (id: string): UserAggregate => {
    const current = map[id];
    if (current) return current;
    const created = { ...EMPTY_AGGREGATE };
    map[id] = created;
    return created;
  };

  const txRows = (txRes.data ?? []) as {
    user_id: string | null;
    type: string;
    amount: number | null;
    status: string;
  }[];
  for (const row of txRows) {
    if (!row.user_id) continue;
    const agg = ensure(row.user_id);
    const amount = Math.abs(asNumber(row.amount));
    if (row.status === "completed" && (EARNINGS_TYPES as readonly string[]).includes(row.type)) {
      agg.totalEarned = round2(agg.totalEarned + amount);
    } else if (row.type === "withdrawal" && (row.status === "completed" || row.status === "pending")) {
      agg.totalWithdrawn = round2(agg.totalWithdrawn + amount);
    }
  }

  const refRows = (refRes.data ?? []) as { referred_by: string | null }[];
  for (const row of refRows) {
    if (row.referred_by) ensure(row.referred_by).referralCount += 1;
  }

  for (const agg of Object.values(map)) {
    agg.availableBalance = round2(agg.totalEarned - agg.totalWithdrawn);
  }
  return map;
}

// One RPC (or one batched fallback) for every user on the page, so the Users
// tab never issues a query per row.
async function fetchUserAggregates(): Promise<{
  map: Record<string, UserAggregate>;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("admin_user_aggregates", { ids: null });
  if (!error) return { map: aggregateRowsToMap(data), error: null };

  logSupabaseError("admin_user_aggregates RPC", error);
  try {
    return { map: await fetchAggregatesFallback(), error: null };
  } catch (fallbackError) {
    logSupabaseError(
      "user aggregates fallback",
      fallbackError as { code?: string; message?: string; details?: string; hint?: string },
    );
    return {
      map: {},
      error:
        fallbackError instanceof Error
          ? fallbackError.message
          : "Couldn't load earnings for the users list.",
    };
  }
}

// Every mutating action re-checks is_admin against the signed-in session, so
// the buttons cannot be driven by a non-admin (RLS enforces it server-side
// too, see the add_is_admin migration).
async function assertAdmin(): Promise<string> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const userId = auth.user?.id;
  if (!userId) throw new Error("You must be signed in as an admin.");
  const { data, error } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  if ((data as { is_admin?: boolean } | null)?.is_admin !== true) {
    throw new Error("Only admins can perform this action.");
  }
  return userId;
}

const logSupabaseError = (
  action: string,
  error: { code?: string; message?: string; details?: string; hint?: string },
) => {
  console.error(`[admin] ${action} failed:`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
};

// admin_user_emails()/get_all_user_emails() return TABLE(id, email). PostgREST
// normally ships plain objects, but a single-column composite can arrive
// wrapped, so accept both shapes instead of silently dropping every row.
const addEmailRows = (rows: unknown, into: Record<string, string>): number => {
  if (!Array.isArray(rows)) return 0;
  let added = 0;
  for (const raw of rows) {
    let row = raw as Record<string, unknown> | null;
    if (row && typeof row === "object" && !("email" in row)) {
      const nested = Object.values(row).find(
        (value) => value && typeof value === "object" && "email" in (value as object),
      );
      if (nested) row = nested as Record<string, unknown>;
    }
    const id = typeof row?.["id"] === "string" ? row["id"] : null;
    const email = typeof row?.["email"] === "string" ? row["email"] : null;
    if (id && email) {
      into[id] = email;
      added += 1;
    }
  }
  return added;
};

async function fetchEmails(
  ids: string[],
): Promise<{ map: Record<string, string>; error: string | null }> {
  const map: Record<string, string> = {};
  if (ids.length === 0) return { map, error: null };

  const primary = await supabase.rpc("admin_user_emails", { ids });
  if (primary.error) {
    logSupabaseError("admin_user_emails RPC", primary.error);
  } else {
    const added = addEmailRows(primary.data, map);
    console.log("[admin] admin_user_emails RPC", {
      requested: ids.length,
      returned: added,
      sample: Array.isArray(primary.data) ? primary.data[0] : primary.data,
    });
  }

  if (ids.every((id) => map[id])) return { map, error: null };

  // Fallback for deployments where admin_user_emails() is missing or broken.
  const fallback = await supabase.rpc("get_all_user_emails", { ids: null });
  if (fallback.error) {
    logSupabaseError("get_all_user_emails RPC", fallback.error);
    return { map, error: fallback.error.message };
  }
  const added = addEmailRows(fallback.data, map);
  console.log("[admin] get_all_user_emails RPC", { returned: added });
  const missing = ids.filter((id) => !map[id]).length;
  return {
    map,
    error:
      missing > 0
        ? `${missing} user email(s) unavailable — run supabase/migrations/20261029000000_admin_rls_and_emails.sql.`
        : null,
  };
}

// Update one profile as an admin and prove it happened. An RLS-blocked UPDATE
// returns no error and changes 0 rows, which is why these actions used to look
// silent; asking for the affected rows turns that into a real, visible error.
async function updateProfile(
  userId: string,
  patch: TablesUpdate<"profiles">,
  action: string,
): Promise<void> {
  console.log(`[admin] ${action}`, { userId, patch });
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select("id");

  if (error) {
    logSupabaseError(`${action} (profiles update)`, error);
    throw new Error(error.hint ? `${error.message} — ${error.hint}` : error.message);
  }
  if (!data || data.length === 0) {
    console.error(`[admin] ${action}: Supabase updated 0 rows`, { userId, patch });
    throw new Error(
      "Supabase updated 0 rows — the admin RLS policy blocked it. Run supabase/migrations/20261029000000_admin_rls_and_emails.sql.",
    );
  }
  console.log(`[admin] ${action}: profile updated`, { userId, columns: Object.keys(patch) });
}
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
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [aggregates, setAggregates] = useState<Record<string, UserAggregate>>({});
  const [aggregatesError, setAggregatesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [planUser, setPlanUser] = useState<AdminUser | null>(null);
  const [planPick, setPlanPick] = useState<string>("none");
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editDraft, setEditDraft] = useState({
    earned: "0",
    available: "0",
    isAdmin: false,
    kyc: "unverified",
  });
  // Collapsible per-row action menu, anchored to the Actions button.
  const [actionsFor, setActionsFor] = useState<{
    userId: string;
    top: number;
    left: number;
  } | null>(null);
  // Transaction history modal.
  const [txUser, setTxUser] = useState<AdminUser | null>(null);
  const [txRows, setTxRows] = useState<Tx[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  // Support ticket reply modal.
  const [replyTicket, setReplyTicket] = useState<SupportTicket | null>(null);
  const [replyMessages, setReplyMessages] = useState<SupportMessage[]>([]);
  const [replyMessagesLoading, setReplyMessagesLoading] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // profiles has no email column, so nothing here selects or embeds it
      // (that used to raise PGRST204 / PGRST200). Emails are resolved from
      // auth.users afterwards through the admin_user_emails() RPC.
      //
      // Earnings aggregates are fetched in the same Promise.all: one
      // admin_user_aggregates() RPC covers every user row, so the tab needs a
      // single extra round-trip rather than a query per user.
      const [dep, wd, kyc, userRows, agg, support] = await Promise.all([
        supabase.from("transactions").select(TX_COLS).eq("type", "deposit").eq("status", "pending").order("created_at"),
        supabase.from("transactions").select(TX_COLS).eq("type", "withdrawal").eq("status", "pending").order("created_at"),
        supabase.from("profiles").select("id,full_name,kyc_status,id_card_url,created_at").eq("kyc_status", "pending").order("created_at"),
        fetchAdminUsers(),
        fetchUserAggregates(),
        supabase.from("support_tickets").select("*").order("created_at", { ascending: false }),
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
      setUsers(userRows);
      setSupportTickets(((support as { data?: unknown[] })?.data ?? []) as SupportTicket[]);
      setAggregates(agg.map);
      setAggregatesError(agg.error);

      // One RPC call covers every row on the page (deposits, withdrawals, KYC
      // and the users table), so the panel needs a single extra round-trip and
      // no per-row query.
      const ids = [
        ...new Set(
          [...deps, ...wds]
            .map((tx) => tx.user_id)
            .concat(kycRows.map((u) => u.id))
            .concat(userRows.map((u) => u.id))
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      if (ids.length === 0) {
        setEmails({});
        setEmailsError(null);
        return;
      }

      const { map, error: emailError } = await fetchEmails(ids);
      setEmails(map);
      setEmailsError(emailError);
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

  // Re-read the aggregates after a deposit/withdrawal decision: approving a
  // deposit can pay a referral bonus, and rejecting a withdrawal refunds the
  // balance, so Total Earned / Available Balance move without a full reload.
  const refreshAggregates = useCallback(async () => {
    const { map, error } = await fetchUserAggregates();
    setAggregates(map);
    setAggregatesError(error);
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/login", replace: true });
  };

  const approveDeposit = async (tx: Tx) => {
    if (!tx.user_id) {
      toast.error("Transaction has no user.");
      return;
    }
    setBusyId(tx.id);
    try {
      const credit = Number(tx.deposit_amount ?? tx.amount);
      if (!Number.isFinite(credit) || credit <= 0) throw new Error("Invalid deposit amount.");
      const { error: txErr } = await supabase.from("transactions").update({ status: "completed" }).eq("id", tx.id);
      if (txErr) throw txErr;
      const { data: up, error: uErr } = await supabase.from("profiles").select("id,full_name,main_balance,referred_by").eq("id", tx.user_id).maybeSingle();
      if (uErr) throw uErr;
      if (!up) throw new Error("User profile not found.");
      const nextBal = Math.round((Number(up.main_balance ?? 0) + credit) * 100) / 100;
      // Start (or restart) the 365-day plan window as soon as a deposit is
      // approved, so the dashboard can render "Day X / 365".
      const planStartedAt = new Date();
      const planExpiresAt = new Date(planStartedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
      const planPatch = {
        main_balance: nextBal,
        ...(tx.plan_name ? { plan_name: tx.plan_name } : {}),
        plan_started_at: planStartedAt.toISOString(),
        plan_expires_at: planExpiresAt.toISOString(),
      };
      try {
        await updateProfile(tx.user_id, planPatch, "approve deposit (balance + plan)");
      } catch (err) {
        // Tolerate databases that have not run the dashboard profile migration
        // yet: the balance credit must still succeed.
        const message = err instanceof Error ? err.message : "";
        if (!/plan_name|plan_(started|expires)_at/i.test(message)) throw err;
        await updateProfile(tx.user_id, { main_balance: nextBal }, "approve deposit (balance only)");
      }
      const refId = (up as { referred_by?: string | null }).referred_by;
      if (refId) {
        const bonus = Math.round(credit * 0.1 * 100) / 100;
        const { data: ref } = await supabase.from("profiles").select("id,main_balance").eq("id", refId).maybeSingle();
        if (ref) {
          const nextRef = Math.round((Number(ref.main_balance ?? 0) + bonus) * 100) / 100;
          await supabase.from("profiles").update({ main_balance: nextRef }).eq("id", refId);
          // Link the bonus to the referred user so the dashboard can show how
          // much was earned from each referral (see the referral-bonus
          // migration for transactions.referred_user_id).
          const referredName = up.full_name || "referred user";
          let { error: bonusErr } = await supabase.from("transactions").insert({
            user_id: refId,
            type: "referral_bonus",
            amount: bonus,
            status: "completed",
            referred_user_id: tx.user_id,
            description: `10% referral bonus from ${referredName}'s ${money(credit)} deposit`,
          });
          // Databases without the referral-bonus migration yet reject the new
          // columns; the bonus itself must still be recorded.
          if (bonusErr && (bonusErr.code === "PGRST204" || bonusErr.code === "42703")) {
            ({ error: bonusErr } = await supabase.from("transactions").insert({
              user_id: refId,
              type: "referral_bonus",
              amount: bonus,
              status: "completed",
            }));
          }
          if (bonusErr) throw bonusErr;
          toast.success(`Approved. Referrer earned ${money(bonus)}.`);
        } else toast.success("Approved (referrer not found).");
      } else toast.success("Deposit approved.");
      setDeposits((d) => d.filter((t) => t.id !== tx.id));
      void refreshAggregates();
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
      void refreshAggregates();
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
      void refreshAggregates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't approve withdrawal.");
    } finally {
      setBusyId(null);
    }
  };

  const rejectWithdrawal = async (tx: Tx) => {
    if (!tx.user_id) {
      toast.error("Transaction has no user.");
      return;
    }
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
      void refreshAggregates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reject withdrawal.");
    } finally {
      setBusyId(null);
    }
  };

  const setKyc = async (userId: string, status: "verified" | "rejected") => {
    setBusyId(userId);
    try {
      await assertAdmin();
      await updateProfile(userId, { kyc_status: status }, `KYC ${status}`);
      setKycUsers((u) => u.filter((x) => x.id !== userId));
      setUsers((list) => list.map((u) => (u.id === userId ? { ...u, kyc_status: status } : u)));
      toast.success(`KYC ${status}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update KYC.");
    } finally {
      setBusyId(null);
    }
  };

  const patchUser = (id: string, patch: Partial<AdminUser>) => {
    setUsers((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  };

  const label = (user: AdminUser) => emails[user.id] ?? (user.full_name || short(user.id, 10));

  const resetWithdrawLimit = async (user: AdminUser) => {
    setBusyUserId(user.id);
    try {
      await assertAdmin();
      await updateProfile(user.id, { last_withdraw_at: null }, "reset withdraw limit");
      patchUser(user.id, { last_withdraw_at: null });
      toast.success(`Withdraw limit reset for ${label(user)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't reset the withdraw limit.");
    } finally {
      setBusyUserId(null);
    }
  };

  const sendPasswordReset = async (user: AdminUser) => {
    setBusyUserId(user.id);
    try {
      await assertAdmin();
      const email = emails[user.id];
      if (!email) {
        throw new Error(
          "No email address on file for this user. Run supabase/migrations/20261029000000_admin_rls_and_emails.sql so the admin email RPC works.",
        );
      }
      // The recovery link lands on /update-password, which turns the token into
      // a session and lets the user pick a new password. Supabase also requires
      // this exact URL in Auth > URL Configuration.
      const redirectTo =
        typeof window !== "undefined" ? `${window.location.origin}/update-password` : undefined;
      const { error } = await supabase.auth.resetPasswordForEmail(
        email,
        redirectTo ? { redirectTo } : undefined,
      );
      if (error) {
        console.error("[admin] resetPasswordForEmail failed:", {
          email,
          redirectTo,
          status: error.status,
          code: error.code,
          message: error.message,
        });
        throw new Error(error.message);
      }
      console.log("[admin] resetPasswordForEmail sent", { email, redirectTo });
      toast.success(`Password reset email sent to ${email}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the reset email.");
    } finally {
      setBusyUserId(null);
    }
  };

  const toggleSuspend = async (user: AdminUser) => {
    setBusyUserId(user.id);
    try {
      const adminId = await assertAdmin();
      if (user.id === adminId) throw new Error("You can't hold your own account.");
      const next = !user.is_suspended;
      await updateProfile(user.id, { is_suspended: next }, next ? "hold account" : "unhold account");
      patchUser(user.id, { is_suspended: next });
      toast.success(next ? `${label(user)} held.` : `${label(user)} released.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the account status.");
    } finally {
      setBusyUserId(null);
    }
  };

  const openReplyModal = (ticket: SupportTicket) => {
    setReplyTicket(ticket);
    setReplyDraft("");
    setReplyMessages([]);
    void fetchTicketMessages(ticket.id);
  };

  const fetchTicketMessages = async (ticketId: string) => {
    setReplyMessagesLoading(true);
    try {
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      setReplyMessages((data ?? []) as SupportMessage[]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load messages.");
    } finally {
      setReplyMessagesLoading(false);
    }
  };

  const sendAdminMessage = async () => {
    if (!replyTicket) return;
    const m = replyDraft.trim();
    if (!m) return;
    setReplyBusy(true);
    try {
      const senderId = await assertAdmin();
      const { error } = await supabase.from("support_messages").insert({
        ticket_id: replyTicket.id,
        sender_id: senderId,
        message: m,
      });
      if (error) throw error;
      setReplyDraft("");
      await fetchTicketMessages(replyTicket.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send message.");
    } finally {
      setReplyBusy(false);
    }
  };

  const markResolved = async () => {
    if (!replyTicket) return;
    setResolveBusy(true);
    try {
      const { error } = await supabase
        .from("support_tickets")
        .update({ status: "resolved" })
        .eq("id", replyTicket.id);
      if (error) throw error;
      setSupportTickets((prev) =>
        prev.map((t) =>
          t.id === replyTicket.id ? { ...t, status: "resolved" } : t,
        ),
      );
      setReplyTicket({ ...replyTicket, status: "resolved" });
      toast.success("Ticket marked as resolved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't resolve ticket.");
    } finally {
      setResolveBusy(false);
    }
  };
  const deleteUser = async (user: AdminUser) => {
    if (!confirm(`Delete ${label(user)} permanently?`)) return;
    setBusyUserId(user.id);
    try {
      const { error } = await supabase.rpc("admin_delete_user", { target_user_id: user.id });
      if (error) throw error;
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
      toast.success(`${label(user)} deleted.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete user.");
    } finally {
      setBusyUserId(null);
    }
  };
const openPlanModal = (user: AdminUser) => {
    const current = user.plan_name ?? "none";
    setPlanPick((PLANS as readonly string[]).includes(current) ? current : "none");
    setPlanUser(user);
  };

  const savePlan = async (mode: "update" | "cancel") => {
    if (!planUser) return;
    const target = planUser;
    setBusyUserId(target.id);
    try {
      await assertAdmin();
      const planName = mode === "cancel" || planPick === "none" ? null : planPick;
      const now = new Date();
      const patch = planName
        ? {
            plan_name: planName,
            plan_started_at: now.toISOString(),
            plan_expires_at: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
          }
        : { plan_name: null, plan_started_at: null, plan_expires_at: null };
      await updateProfile(target.id, patch, planName ? `update plan (${planName})` : "cancel plan");
      patchUser(target.id, patch);
      setPlanUser(null);
      toast.success(planName ? `Plan updated to ${planName}.` : "Plan cancelled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the plan.");
    } finally {
      setBusyUserId(null);
    }
  };

  // --- Collapsible Actions menu -------------------------------------------
  const toggleActions = (userId: string, event: MouseEvent<HTMLButtonElement>) => {
    if (actionsFor?.userId === userId) {
      setActionsFor(null);
      return;
    }
    // Anchor the menu to the button: the table scrolls horizontally, so an
    // absolutely positioned menu would be clipped by its overflow container.
    const rect = event.currentTarget.getBoundingClientRect();
    setActionsFor({ userId, top: rect.bottom + 6, left: Math.max(8, rect.right - 224) });
  };
  const closeActions = () => setActionsFor(null);

  useEffect(() => {
    if (!actionsFor) return;
    const close = () => setActionsFor(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    // The menu is anchored to the button, so anything that moves the page or
    // the table would leave it floating in the wrong place.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [actionsFor]);

  // --- Transaction history ------------------------------------------------
  const openTransactions = async (user: AdminUser) => {
    setTxUser(user);
    setTxRows([]);
    setTxError(null);
    setTxLoading(true);
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select(TX_COLS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setTxRows((data ?? []) as Tx[]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't load transactions.";
      console.error("[admin] transaction history failed:", err);
      setTxError(message);
    } finally {
      setTxLoading(false);
    }
  };

  // --- Edit earnings & KYC ------------------------------------------------
  const openEditModal = (user: AdminUser) => {
    const agg = aggregates[user.id] ?? EMPTY_AGGREGATE;
    setEditDraft({
      earned: String(round2(agg.totalEarned)),
      available: String(round2(agg.availableBalance)),
      isAdmin: user.is_admin === true,
      kyc: user.kyc_status ?? "unverified",
    });
    setEditUser(user);
  };

  // Available = Total Earned - Total Withdrawn, so the two inputs stay in step:
  // editing one recalculates the other against the (fixed) withdrawn total.
  const editWithdrawn = editUser
    ? (aggregates[editUser.id] ?? EMPTY_AGGREGATE).totalWithdrawn
    : 0;

  const changeEarned = (value: string) => {
    setEditDraft((draft) => ({
      ...draft,
      earned: value,
      available:
        value.trim() === "" ? "" : String(round2(Number(value) - editWithdrawn)),
    }));
  };

  const changeAvailable = (value: string) => {
    setEditDraft((draft) => ({
      ...draft,
      available: value,
      earned: value.trim() === "" ? "" : String(round2(Number(value) + editWithdrawn)),
    }));
  };

  const saveEdits = async () => {
    if (!editUser) return;
    const target = editUser;
    const agg = aggregates[target.id];
    setBusyUserId(target.id);
    try {
      if (!agg) {
        throw new Error("Earnings are unavailable for this user right now. Refresh and try again.");
      }
      const earned = Number(editDraft.earned);
      const available = Number(editDraft.available);
      if (!Number.isFinite(earned) || earned < 0) {
        throw new Error("Total Earned must be a number 0 or greater.");
      }
      if (!Number.isFinite(available) || available < 0) {
        throw new Error("Available Balance must be a number 0 or greater.");
      }
      const adminId = await assertAdmin();
      if (target.id === adminId && !editDraft.isAdmin) {
        throw new Error("You can't remove your own admin access.");
      }

      // The gap between the requested Total Earned and the aggregated figure
      // becomes a manual adjustment on the profile. Available Balance moves by
      // the same delta because withdrawals are unchanged. Deposits are never
      // part of either number.
      const delta = round2(earned - agg.totalEarned);
      const nextAdjustment = round2(agg.adjustment + delta);
      // The dashboard reads profiles.main_balance, so mirror the delta there or
      // the manual adjustment would never reach the user.
      const nextMain = Math.max(0, round2(Number(target.main_balance ?? 0) + delta));
      const patch = {
        earnings_adjustment: nextAdjustment,
        main_balance: nextMain,
        is_admin: editDraft.isAdmin,
        kyc_status: editDraft.kyc,
      };

      try {
        await updateProfile(target.id, patch, "edit earnings/KYC");
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        // A deployment without the aggregate migration cannot store the
        // adjustment column; the balance/KYC part must still save.
        if (!/earnings_adjustment/i.test(message)) throw err;
        await updateProfile(
          target.id,
          { main_balance: nextMain, is_admin: editDraft.isAdmin, kyc_status: editDraft.kyc },
          "edit balance/KYC",
        );
        toast.warning(
          "Balance saved, but Total Earned needs supabase/migrations/20261030000000_admin_user_aggregates.sql to persist.",
        );
      }

      patchUser(target.id, {
        main_balance: nextMain,
        is_admin: editDraft.isAdmin,
        kyc_status: editDraft.kyc,
      });
      setAggregates((current) => ({
        ...current,
        [target.id]: {
          ...agg,
          totalEarned: round2(agg.totalEarned + delta),
          availableBalance: round2(agg.availableBalance + delta),
          adjustment: nextAdjustment,
        },
      }));
      setEditUser(null);
      toast.success(`Saved changes for ${label(target)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the changes.");
    } finally {
      setBusyUserId(null);
    }
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "deposits", label: "Pending Deposits", count: deposits.length },
    { id: "users", label: "Users", count: users.length },
    { id: "withdrawals", label: "Pending Withdrawals", count: withdrawals.length },
    { id: "kyc", label: "KYC Verifications", count: kycUsers.length },
    { id: "support", label: "Support Tickets", count: supportTickets.length },
  ];

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const email = (emails[u.id] ?? "").toLowerCase();
      const name = (u.full_name ?? "").toLowerCase();
      return email.includes(q) || name.includes(q);
    });
  }, [users, emails, userSearch]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/"><img src="/logo.png" alt="Roket" className="h-9" /></Link>
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
        <p className="mt-2 text-sm text-muted-foreground">Approve deposits (pays 10% referral bonus), review withdrawals, verify KYC, and manage user accounts.</p>
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
        ) : (<><div className="mt-6">{tab === "deposits" && (
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
        {tab === "users" && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search by email or name…"
                aria-label="Search users by email or name"
                className="w-full max-w-sm rounded-lg border border-border bg-muted/70 px-4 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
              />
              <span className="text-xs text-muted-foreground">
                {filteredUsers.length} of {users.length} users
              </span>
            </div>
            {emailsError && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Emails unavailable: {emailsError}
              </p>
            )}
            {aggregatesError && (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Earnings unavailable: {aggregatesError} — run
                supabase/migrations/20261030000000_admin_user_aggregates.sql.
              </p>
            )}
            <div className="overflow-hidden rounded-2xl border bg-card">
              <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm">
                <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-3">Email</th><th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Total Earned</th><th className="px-4 py-3">Available Balance</th>
                  <th className="px-4 py-3">Referrals</th><th className="px-4 py-3">KYC Status</th>
                  <th className="px-4 py-3">Plan Name</th><th className="px-4 py-3">Account Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {filteredUsers.length === 0 && (<tr><td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">{users.length === 0 ? "No users yet." : "No users match that search."}</td></tr>)}
                  {filteredUsers.map((u) => {
                    // Earnings come from completed transactions only — a deposit
                    // is never shown as (or editable as) a balance.
                    const agg = aggregates[u.id];
                    return (
                    <tr key={u.id} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-3 font-medium">{emails[u.id] ?? short(u.id, 10)}</td>
                      <td className="px-4 py-3">{u.full_name || "—"}</td>
                      <td className="px-4 py-3 font-semibold text-primary" title="Completed daily profit + ad rewards + referral bonuses (deposits excluded)">{agg ? money(agg.totalEarned) : "—"}</td>
                      <td className="px-4 py-3" title={agg ? `Earned ${money(agg.totalEarned)} − withdrawn ${money(agg.totalWithdrawn)}` : "Earnings unavailable"}>{agg ? money(agg.availableBalance) : "—"}</td>
                      <td className="px-4 py-3">{agg ? agg.referralCount : "—"}</td>
                      <td className="px-4 py-3">
                        <span className={u.kyc_status === "verified"
                          ? "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400"
                          : u.kyc_status === "rejected"
                            ? "rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive"
                            : "rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground"}>
                          {u.kyc_status ?? "unverified"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{u.plan_name ?? "None"}</td>
                      <td className="px-4 py-3">
                        <span className={u.is_suspended
                          ? "rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive"
                          : "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400"}>
                          {u.is_suspended ? "Held" : "Active"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button type="button" aria-haspopup="menu" aria-expanded={actionsFor?.userId === u.id} disabled={busyUserId === u.id} onClick={(event) => toggleActions(u.id, event)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50">
                          {busyUserId === u.id ? "…" : "Actions"}
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
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
        {tab === "support" && (
          <section className="overflow-hidden rounded-2xl border bg-card">
            <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm">
              <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                <th className="px-4 py-3">User</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Message</th><th className="px-4 py-3">Image</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {supportTickets.length === 0 && (<tr><td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">No support tickets.</td></tr>)}
                {supportTickets.map((t) => (
                  <tr key={t.id} className="border-b border-border/40 last:border-0">
                    <td className="px-4 py-3 font-medium">{t.user_id ? (emails[t.user_id] ?? short(t.user_id, 10)) : "—"}</td>
                    <td className="px-4 py-3">{t.category ?? "general"}</td>
                    <td className="px-4 py-3">{t.subject}</td>
                    <td className="px-4 py-3 max-w-xs truncate">{t.message}</td>
                    <td className="px-4 py-3">{t.image_url ? <a href={t.image_url} target="_blank" rel="noreferrer" className="text-primary underline">View</a> : "—"}</td>
                    <td className="px-4 py-3">{t.status}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-2">
                      <button type="button" onClick={() => openReplyModal(t)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">View & Reply</button>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )}
        </div>
        {actionsFor && (() => {
          const target = users.find((u) => u.id === actionsFor.userId);
          if (!target) return null;
          const itemClass = "block w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50";
          return (
            <>
              <div className="fixed inset-0 z-40" onClick={closeActions} aria-hidden="true" />
              <div aria-label={`Actions for ${label(target)}`} style={{ top: actionsFor.top, left: actionsFor.left }} className="fixed z-50 w-56 rounded-xl border bg-card p-1.5 shadow-xl">
                <button type="button" disabled={busyUserId === target.id} onClick={() => { closeActions(); void openTransactions(target); }} className={itemClass}>View Transactions</button>
                <button type="button" disabled={busyUserId === target.id} onClick={() => { closeActions(); void resetWithdrawLimit(target); }} className={itemClass}>Reset Withdraw Limit</button>
                <button type="button" disabled={busyUserId === target.id} onClick={() => { closeActions(); void sendPasswordReset(target); }} className={itemClass}>Send Reset Password</button>
                <button type="button" disabled={busyUserId === target.id} onClick={() => { closeActions(); void toggleSuspend(target); }} className={itemClass}>{target.is_suspended ? "Unhold Account" : "Hold Account"}</button>
                <button type="button" disabled={busyUserId === target.id} onClick={() => { closeActions(); void deleteUser(target); }} className={itemClass}>Delete User</button>
                <button type="button" disabled={busyUserId === target.id} onClick={() => { closeActions(); openPlanModal(target); }} className={itemClass}>Manage Plan</button>
                <button type="button" disabled={busyUserId === target.id} onClick={() => { closeActions(); openEditModal(target); }} className={itemClass}>Edit Balances &amp; KYC</button>
              </div>
            </>
          );
        })()}
        {txUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" role="dialog" aria-modal="true" aria-labelledby="tx-modal-title">
            <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border bg-card p-6 shadow-xl">
              <h2 id="tx-modal-title" className="font-display text-xl font-bold">Transaction history</h2>
              <p className="mt-1 text-sm text-muted-foreground">{label(txUser)}</p>
              <div className="mt-5 flex-1 overflow-auto rounded-xl border">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                    <th className="px-4 py-3">Date</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th>
                  </tr></thead>
                  <tbody>
                    {txLoading && (<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">Loading transactions…</td></tr>)}
                    {!txLoading && txError && (<tr><td colSpan={4} className="px-4 py-10 text-center text-destructive">{txError}</td></tr>)}
                    {!txLoading && !txError && txRows.length === 0 && (<tr><td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">No transactions yet.</td></tr>)}
                    {!txLoading && !txError && txRows.map((tx) => (
                      <tr key={tx.id} className="border-b border-border/40 last:border-0">
                        <td className="px-4 py-3 text-muted-foreground">{new Date(tx.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 capitalize">{tx.type.replace(/_/g, " ")}</td>
                        <td className={tx.type === "withdrawal" ? "px-4 py-3 font-semibold text-destructive" : "px-4 py-3 font-semibold text-primary"}>{money(Number(tx.amount))}</td>
                        <td className="px-4 py-3">
                          <span className={tx.status === "completed"
                            ? "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400"
                            : tx.status === "pending"
                              ? "rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400"
                              : "rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive"}>
                            {tx.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={() => setTxUser(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Close</button>
              </div>
            </div>
          </div>
        )}
        </>
        )}
        {planUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" role="dialog" aria-modal="true" aria-labelledby="plan-modal-title">
            <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
              <h2 id="plan-modal-title" className="font-display text-xl font-bold">Manage plan</h2>
              <p className="mt-1 text-sm text-muted-foreground">{label(planUser)}</p>
              <label htmlFor="plan-select" className="mt-5 block text-sm font-medium">Plan</label>
              <select id="plan-select" value={planPick} onChange={(e) => setPlanPick(e.target.value)} className="mt-1.5 w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20">
                <option value="none">None</option>
                {PLANS.map((p) => (<option key={p} value={p}>{p}</option>))}
              </select>
              <p className="mt-2 text-xs text-muted-foreground">Update Plan starts a fresh 365-day window from now. Cancel Plan clears the plan and its dates.</p>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" onClick={() => setPlanUser(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Close</button>
                <button type="button" disabled={busyUserId === planUser.id} onClick={() => void savePlan("cancel")} className="rounded-lg bg-destructive/90 px-4 py-2 text-sm font-bold text-white hover:bg-destructive disabled:opacity-50">Cancel Plan</button>
                <button type="button" disabled={busyUserId === planUser.id} onClick={() => void savePlan("update")} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-primary-foreground shadow-glow disabled:opacity-50">Update Plan</button>
              </div>
            </div>
          </div>
        )}
        {editUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-modal-title">
            <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
              <h2 id="edit-modal-title" className="font-display text-xl font-bold">Edit earnings &amp; KYC</h2>
              <p className="mt-1 text-sm text-muted-foreground">{label(editUser)}</p>
              <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Total Earned comes from completed daily profit, ad rewards and referral bonuses. Available Balance is
                Total Earned minus withdrawals (completed + pending). Deposits are never included; editing either field
                stores a manual adjustment.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="edit-earned" className="text-sm font-medium">Total Earned</label>
                  <input id="edit-earned" type="number" min="0" step="0.01" value={editDraft.earned} onChange={(e) => changeEarned(e.target.value)} className="w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="edit-available" className="text-sm font-medium">Available Balance</label>
                  <input id="edit-available" type="number" min="0" step="0.01" value={editDraft.available} onChange={(e) => changeAvailable(e.target.value)} className="w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Withdrawn so far: {money(editWithdrawn)}.
              </p>
              <div className="mt-4 space-y-1.5">
                <label htmlFor="edit-kyc" className="text-sm font-medium">KYC status</label>
                <select id="edit-kyc" value={editDraft.kyc} onChange={(e) => setEditDraft((d) => ({ ...d, kyc: e.target.value }))} className="w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20">
                  {KYC_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div>
              <label className="mt-4 flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={editDraft.isAdmin} onChange={(e) => setEditDraft((d) => ({ ...d, isAdmin: e.target.checked }))} className="h-4 w-4 rounded border-border" />
                Admin access (is_admin)
              </label>
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" onClick={() => setEditUser(null)} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">Close</button>
                <button type="button" disabled={busyUserId === editUser.id} onClick={() => void saveEdits()} className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-primary-foreground shadow-glow disabled:opacity-50">Save changes</button>
              </div>
            </div>
          </div>
        )}
                {replyTicket && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reply-modal-title"
            onClick={() => {
              setReplyTicket(null);
              setReplyDraft("");
            }}
          >
            <div
              className="relative flex h-[80vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border bg-card p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  setReplyTicket(null);
                  setReplyDraft("");
                }}
                className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
              <h2 id="reply-modal-title" className="font-display text-xl font-bold">Ticket Chat</h2>
              <div className="mt-3 space-y-2 text-sm">
                <p><span className="font-semibold">User:</span> {replyTicket.user_id ? (emails[replyTicket.user_id] ?? short(replyTicket.user_id, 10)) : "—"}</p>
                <p><span className="font-semibold">Category:</span> {replyTicket.category ?? "general"}</p>
                <div>
                  <span className="font-semibold">Status:</span>{" "}
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${replyTicket.status?.toLowerCase() === "resolved" ? "bg-emerald-500/15 text-emerald-600" : "bg-sky-500/15 text-sky-600"}`}>
                    {replyTicket.status || "open"}
                  </span>
                </div>
                <div>
                  <div className="font-semibold">Subject</div>
                  <div className="whitespace-pre-wrap text-muted-foreground">{replyTicket.subject}</div>
                </div>
                <div>
                  <div className="font-semibold">Message</div>
                  <div className="whitespace-pre-wrap text-muted-foreground">{replyTicket.message}</div>
                </div>
                {replyTicket.image_url && (
                  <div>
                    <div className="font-semibold">Attached Image</div>
                    <a href={replyTicket.image_url} target="_blank" rel="noreferrer">
                      <img src={replyTicket.image_url} alt="Ticket attachment" className="mt-1 max-h-64 rounded-lg border object-contain" />
                    </a>
                  </div>
                )}
              </div>

              <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3">
                {replyMessagesLoading ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : replyMessages.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground">No messages yet.</div>
                ) : (
                  replyMessages.map((msg) => {
                    const isAdmin = msg.sender_id !== replyTicket.user_id;
                    return (
                      <div key={msg.id} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${isAdmin ? "bg-brand text-primary-foreground" : "bg-background border"}`}>
                          <div className="whitespace-pre-wrap">{msg.message}</div>
                          <div className={`mt-1 text-[10px] ${isAdmin ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {new Date(msg.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="mt-4 space-y-2">
                <textarea
                  id="admin-reply"
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                  placeholder="Type a message..."
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={replyBusy || !replyDraft.trim()}
                    onClick={() => void sendAdminMessage()}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-primary-foreground shadow-glow disabled:opacity-50"
                  >
                    {replyBusy ? "…" : "Send Message"}
                  </button>
                  <button
                    type="button"
                    disabled={resolveBusy || replyTicket.status?.toLowerCase() === "resolved"}
                    onClick={() => void markResolved()}
                    className="rounded-lg border border-emerald-500/40 px-4 py-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {resolveBusy ? "…" : "Mark as Resolved"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

    </div>
  );
}

