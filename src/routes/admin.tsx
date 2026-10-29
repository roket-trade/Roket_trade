import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { HeaderAuthNav } from "@/components/HeaderAuthNav";
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

type AdminConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "danger";
  onConfirm: () => void | Promise<void>;
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

type Tab =
  "transactions" | "deposits" | "users" | "withdrawals" | "kyc" | "support" | "announcements";

// The All Transactions tab keeps the whole row and, where the deployment
// exposes it, the embedded profile email.
type AllTx = Tx & { profiles?: { email: string | null } | null };

type SupportMessage = {
  id: string;
  ticket_id: string;
  sender_id: string | null;
  message: string;
  created_at: string;
};

type Announcement = {
  id: string;
  title: string;
  message: string;
  type: string;
  is_active: boolean;
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

const EARNINGS_TYPES = ["daily_profit", "ad_earning", "referral_bonus", "welcome_bonus"] as const;
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

/**
 * Best-effort push so a user learns about their withdrawal decision right away.
 * The money has already moved by the time this runs, so a push failure is only
 * logged — it must never surface as an error or make the decision look failed.
 *
 * The logs are deliberately verbose: a push that silently reaches 0 devices is
 * indistinguishable from one that was never sent, so both the request and the
 * function's reply are printed.
 *
 * Targeting: the OneSignal subscription ids are looked up first, because that id
 * is created by the act of subscribing. The external_id alias only exists once
 * `OneSignal.login()` has attached it, and when it silently does not, the API
 * still answers 200 — with `recipients: 0`.
 */
async function sendWithdrawalPush(
  userId: string | null,
  status: "approved" | "rejected",
  amount: number,
): Promise<void> {
  if (!userId) {
    console.warn("[admin] withdrawal push skipped: transaction has no user_id");
    return;
  }

  const message = `Your withdrawal of $${amount.toFixed(2)} has been ${status}.`;

  // Every browser this user has subscribed from. RLS lets admins read these.
  const { data: subscriptionRows, error: subscriptionError } = await supabase
    .from("push_subscriptions")
    .select("subscription_id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (subscriptionError) {
    // A missing table (migration not run) must not block the fallback path.
    console.warn("[admin] could not read push subscriptions:", subscriptionError.message);
  }

  const subscriptionIds = ((subscriptionRows ?? []) as Array<{ subscription_id: string }>)
    .map((row) => row.subscription_id)
    .filter(Boolean);

  const body =
    subscriptionIds.length > 0
      ? { subscription_ids: subscriptionIds, title: "Withdrawal Update", message }
      : { external_user_id: userId, title: "Withdrawal Update", message };

  console.log("[admin] invoking send-push", body);

  try {
    const { data, error } = await supabase.functions.invoke("send-push", { body });

    if (error) {
      console.warn("[admin] withdrawal push failed:", error.message, error);
      return;
    }

    const reply = data as { recipients?: number; errors?: unknown; target?: string } | null;

    if (Number(reply?.recipients ?? 0) === 0) {
      console.warn("[admin] push accepted but reached 0 devices — no subscription matched", reply);
      return;
    }

    console.log("[admin] withdrawal push delivered", reply);
  } catch (err) {
    console.warn("[admin] withdrawal push failed:", err);
  }
}

// Human labels for the transaction types stored in `transactions.type`.
const TX_TYPE_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  referral_bonus: "Referral Bonus",
  ad_earning: "Ads Earning",
  daily_profit: "Daily Profit",
  adjustment: "Adjustment",
};

const txTypeLabel = (type: string) =>
  TX_TYPE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Badges shared by the All Transactions / inline tables.
const statusBadgeClass = (status: string) => {
  if (status === "completed") {
    return "rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400";
  }
  if (status === "pending") {
    return "rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-400";
  }
  if (status === "rejected" || status === "failed") {
    return "rounded-full bg-destructive/15 px-2.5 py-1 text-xs font-semibold text-destructive";
  }
  // Anything else (approved, processing, …) is neutral rather than an error.
  return "rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground";
};

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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

// All Transactions: latest 100 rows across every type/status. `profiles` has no
// email column in this database (see supabase/migrations/20261021010000_admin_join_fix.sql),
// so a `profiles(email)` embed answers PGRST200. Try it once per session — a
// deployment that adds the column then gets the join for free — and fall back to
// the plain select, with emails resolved through admin_user_emails() afterwards.
let profilesEmailEmbedAvailable: boolean | null = null;

async function fetchAllTransactions(): Promise<AllTx[]> {
  if (profilesEmailEmbedAvailable !== false) {
    const embedded = await supabase
      .from("transactions")
      .select(`${TX_COLS},profiles(email)`)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!embedded.error) {
      profilesEmailEmbedAvailable = true;
      return (embedded.data ?? []) as unknown as AllTx[];
    }
    // Only a schema-level rejection (missing column / relationship) is
    // permanent; a transient failure should be retried on the next open.
    const code = embedded.error.code ?? "";
    if (
      code === "PGRST200" ||
      code === "PGRST204" ||
      code === "42703" ||
      /does not exist|relationship/i.test(embedded.error.message ?? "")
    ) {
      profilesEmailEmbedAvailable = false;
    }
    console.warn(
      "[admin] transactions → profiles(email) embed unavailable, using the email RPC:",
      embedded.error.message,
    );
  }

  const plain = await supabase
    .from("transactions")
    .select(TX_COLS)
    .order("created_at", { ascending: false })
    .limit(100);
  if (plain.error) throw plain.error;
  return (plain.data ?? []) as unknown as AllTx[];
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
  const [tab, setTab] = useState<Tab>("deposits");
  const [deposits, setDeposits] = useState<Tx[]>([]);
  const [withdrawals, setWithdrawals] = useState<Tx[]>([]);
  const [kycUsers, setKycUsers] = useState<KycUser[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [aggregates, setAggregates] = useState<Record<string, UserAggregate>>({});
  const [aggregatesError, setAggregatesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  // Paying/destructive actions ask for confirmation before they touch money.
  const [confirmAction, setConfirmAction] = useState<AdminConfirm | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [planUser, setPlanUser] = useState<AdminUser | null>(null);
  const [planPick, setPlanPick] = useState<string>("none");
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editDraft, setEditDraft] = useState({
    balance: "0",
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

  // All Transactions tab — loaded lazily the first time the tab is opened.
  const [allTransactions, setAllTransactions] = useState<AllTx[]>([]);
  const [allTxLoading, setAllTxLoading] = useState(false);
  const [allTxError, setAllTxError] = useState<string | null>(null);

  // Support ticket reply modal.
  const [replyTicket, setReplyTicket] = useState<SupportTicket | null>(null);
  const [replyMessages, setReplyMessages] = useState<SupportMessage[]>([]);
  const [replyMessagesLoading, setReplyMessagesLoading] = useState(false);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyBusy, setReplyBusy] = useState(false);
  const [resolveBusy, setResolveBusy] = useState(false);

  // Announcement form state.
  const [annTitle, setAnnTitle] = useState("");
  const [annMessage, setAnnMessage] = useState("");
  const [annType, setAnnType] = useState("info");
  const [annBusy, setAnnBusy] = useState(false);

  // Reloads every tab's data. `silent` keeps the current tables on screen while
  // the refetch runs, so a decision no longer blanks the panel behind a spinner.
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // profiles has no email column, so nothing here selects or embeds it
      // (that used to raise PGRST204 / PGRST200). Emails are resolved from
      // auth.users afterwards through the admin_user_emails() RPC.
      //
      // Earnings aggregates are fetched in the same Promise.all: one
      // admin_user_aggregates() RPC covers every user row, so the tab needs a
      // single extra round-trip rather than a query per user.
      const [dep, wd, kyc, userRows, agg, support, ann] = await Promise.all([
        supabase.from("transactions").select(TX_COLS).eq("type", "deposit").eq("status", "pending").order("created_at"),
        supabase.from("transactions").select(TX_COLS).eq("type", "withdrawal").eq("status", "pending").order("created_at"),
        supabase.from("profiles").select("id,full_name,kyc_status,id_card_url,created_at").eq("kyc_status", "pending").order("created_at"),
        fetchAdminUsers(),
        fetchUserAggregates(),
        supabase.from("support_tickets").select("*").order("created_at", { ascending: false }),
        supabase.from("announcements").select("*").order("created_at", { ascending: false }),
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
      setAnnouncements(((ann as { data?: unknown[] })?.data ?? []) as Announcement[]);
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
      if (!silent) setLoading(false);
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

  // Latest 100 transactions for the All Transactions tab. Emails come from the
  // embedded profile when the deployment can join it, otherwise from the same
  // admin_user_emails() RPC the rest of the panel uses.
  const loadTransactions = useCallback(async () => {
    setAllTxLoading(true);
    setAllTxError(null);
    try {
      const rows = await fetchAllTransactions();
      setAllTransactions(rows);
      // Keep the shared email map warm so deposits/withdrawals/users/transactions
      // all render the same address for the same user.
      const joined: Record<string, string> = {};
      for (const row of rows) {
        const email = row.profiles?.email;
        if (row.user_id && email) joined[row.user_id] = email;
      }
      if (Object.keys(joined).length > 0) {
        setEmails((prev) => ({ ...joined, ...prev }));
      }
      const missing = [
        ...new Set(
          rows
            .map((row) => row.user_id)
            .filter((id): id is string => Boolean(id) && !joined[id as string]),
        ),
      ];
      if (missing.length > 0) {
        const { map, error: emailError } = await fetchEmails(missing);
        if (Object.keys(map).length > 0) {
          setEmails((prev) => ({ ...prev, ...map }));
        }
        // Surface a broken email RPC on this tab too, otherwise rows quietly
        // fall back to truncated user ids.
        if (emailError) setEmailsError(emailError);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't load transactions.";
      console.error("[admin] transactions load failed:", err);
      setAllTxError(msg);
    } finally {
      setAllTxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "transactions") return;
    void loadTransactions();
  }, [tab, loadTransactions]);

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
      const { data: up, error: uErr } = await supabase.from("profiles").select("id,full_name,referred_by").eq("id", tx.user_id).maybeSingle();
      if (uErr) throw uErr;
      if (!up) throw new Error("User profile not found.");
      // A deposit activates the plan only. It never touches the user's balance;
      // earnings come from daily profits, ads, referrals and the welcome bonus.
      const planStartedAt = new Date();
      const planExpiresAt = new Date(planStartedAt.getTime() + 365 * 24 * 60 * 60 * 1000);
      const planPatch = {
        ...(tx.plan_name ? { plan_name: tx.plan_name } : {}),
        plan_started_at: planStartedAt.toISOString(),
        plan_expires_at: planExpiresAt.toISOString(),
      };
      try {
        await updateProfile(tx.user_id, planPatch, "approve deposit (plan)");
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        if (!/plan_name|plan_(started|expires)_at/i.test(message)) throw err;
      }
      // The deposit is already completed and credited at this point, so the push
      // is best-effort: a failed send is logged and swallowed rather than shown
      // to the admin as a failed approval.
      try {
        const { error: pushErr } = await supabase.functions.invoke("send-push", {
          body: {
            external_user_id: tx.user_id,
            title: "Deposit Confirmed",
            message: `Your deposit of $${tx.amount} has been successfully confirmed and your plan is active.`,
          },
        });
        if (pushErr) console.warn("[admin] deposit push failed:", pushErr.message, pushErr);
      } catch (pushErr) {
        console.warn("[admin] deposit push failed:", pushErr);
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
      void load(true);
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
      void load(true);
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
      void sendWithdrawalPush(tx.user_id, "approved", Math.abs(Number(tx.amount)));
      toast.success("Withdrawal completed.");
      void refreshAggregates();
      void load(true);
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
      const balancePatch = toExtra
        ? { extra_balance: Math.round((Number(up.extra_balance ?? 0) + refund) * 100) / 100 }
        : { main_balance: Math.round((Number(up.main_balance ?? 0) + refund) * 100) / 100 };
      // Rejecting refunds the money AND clears the 7-day cooldown: the request
      // never left the platform, so the user must be able to ask again at once.
      const patch = { ...balancePatch, last_withdraw_at: null };
      const { error: bErr } = await supabase.from("profiles").update(patch).eq("id", tx.user_id);
      if (bErr) throw bErr;
      const { error: tErr } = await supabase.from("transactions").update({ status: "rejected" }).eq("id", tx.id);
      if (tErr) throw tErr;
      setWithdrawals((w) => w.filter((t) => t.id !== tx.id));
      patchUser(tx.user_id, { last_withdraw_at: null });
      void sendWithdrawalPush(tx.user_id, "rejected", refund);
      toast.success(`Rejected. ${money(refund)} refunded.`);
      void refreshAggregates();
      void load(true);
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
      // Mark ticket as replied when admin responds.
      const { error: statusError } = await supabase
        .from("support_tickets")
        .update({ status: "replied" })
        .eq("id", replyTicket.id);
      if (statusError) throw statusError;
      setReplyDraft("");
      setSupportTickets((prev) =>
        prev.map((t) => (t.id === replyTicket.id ? { ...t, status: "replied" } : t)),
      );
      setReplyTicket({ ...replyTicket, status: "replied" });
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
    setEditDraft({
      // Same figure the table renders and saveEdits diffs against: the user's
      // whole balance (main + extra). Seeding this with main_balance alone made
      // an unchanged save silently shave extra_balance off main_balance.
      balance: String(round2(Number(user.main_balance ?? 0) + Number(user.extra_balance ?? 0))),
      isAdmin: user.is_admin === true,
      kyc: user.kyc_status ?? "unverified",
    });
    setEditUser(user);
  };

  const changeBalance = (value: string) => {
    setEditDraft((draft) => ({ ...draft, balance: value }));
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
      const balance = Number(editDraft.balance);
      if (!Number.isFinite(balance) || balance < 0) {
        throw new Error("Balance must be a number 0 or greater.");
      }
      const adminId = await assertAdmin();
      if (target.id === adminId && !editDraft.isAdmin) {
        throw new Error("You can't remove your own admin access.");
      }

      const oldBalance = Number(target.main_balance ?? 0) + Number(target.extra_balance ?? 0);
      const delta = round2(balance - oldBalance);
      const nextMain = round2(Number(target.main_balance ?? 0) + delta);

      const patch = {
        main_balance: nextMain,
        is_admin: editDraft.isAdmin,
        kyc_status: editDraft.kyc,
      };

      await updateProfile(target.id, patch, "edit balance/KYC");

      patchUser(target.id, {
        main_balance: nextMain,
        is_admin: editDraft.isAdmin,
        kyc_status: editDraft.kyc,
      });
      setEditUser(null);
      toast.success(`Saved changes for ${label(target)}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the changes.");
    } finally {
      setBusyUserId(null);
    }
  };

  const createAnnouncement = async () => {
    if (!annTitle.trim() || !annMessage.trim()) {
      toast.error("Title and message are required.");
      return;
    }
    setAnnBusy(true);
    try {
      await assertAdmin();
      const { error } = await supabase.from("announcements").insert({
        title: annTitle.trim(),
        message: annMessage.trim(),
        type: annType,
        is_active: true,
      });
      if (error) throw error;
      toast.success("Announcement created.");
      setAnnTitle("");
      setAnnMessage("");
      setAnnType("info");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create announcement.");
    } finally {
      setAnnBusy(false);
    }
  };

  const toggleAnnouncement = async (a: Announcement) => {
    setBusyId(a.id);
    try {
      await assertAdmin();
      const { error } = await supabase
        .from("announcements")
        .update({ is_active: !a.is_active })
        .eq("id", a.id);
      if (error) throw error;
      setAnnouncements((prev) =>
        prev.map((x) => (x.id === a.id ? { ...x, is_active: !a.is_active } : x)),
      );
      toast.success(a.is_active ? "Deactivated." : "Activated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update announcement.");
    } finally {
      setBusyId(null);
    }
  };

  const deleteAnnouncement = async (a: Announcement) => {
    setBusyId(a.id);
    try {
      await assertAdmin();
      const { error } = await supabase.from("announcements").delete().eq("id", a.id);
      if (error) throw error;
      setAnnouncements((prev) => prev.filter((x) => x.id !== a.id));
      toast.success("Announcement deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete announcement.");
    } finally {
      setBusyId(null);
    }
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "deposits", label: "Pending Deposits", count: deposits.length },
    { id: "users", label: "Users", count: users.length },
    { id: "withdrawals", label: "Pending Withdrawals", count: withdrawals.length },
    { id: "kyc", label: "KYC Verifications", count: kycUsers.length },
    { id: "support", label: "Support Tickets", count: supportTickets.length },
    { id: "announcements", label: "Announcements", count: announcements.length },
    { id: "transactions", label: "All Transactions", count: allTransactions.length },
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
            <HeaderAuthNav current="other" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Admin Panel</p>
        <h1 className="mt-2 font-display text-4xl font-bold">Manage the platform</h1>
        <div className="mt-6 flex flex-col gap-6 md:flex-row">
          <nav
            aria-label="Admin sections"
            className="flex w-full flex-col gap-2 md:w-64"
          >
            {tabs.map((t) => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                aria-current={tab === t.id ? "page" : undefined}
                className={tab === t.id ? "w-full rounded-lg bg-brand px-4 py-2.5 text-left text-sm font-semibold text-primary-foreground shadow-glow" : "w-full rounded-lg border border-border px-4 py-2.5 text-left text-sm font-semibold text-muted-foreground hover:text-foreground"}>
                {t.label} ({t.count})
              </button>
            ))}
            <button type="button" onClick={() => { void load(); if (tab === "transactions") void loadTransactions(); }} className="w-full rounded-lg border border-border px-4 py-2.5 text-left text-sm font-semibold text-muted-foreground hover:text-foreground">Refresh</button>
          </nav>
          <div className="flex-1">
            {loading ? (
              <div className="flex min-h-[40vh] items-center justify-center"><div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" /></div>
            ) : (<>{tab === "transactions" && (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-xl font-bold">All Transactions</h2>
                    <p className="mt-1 text-xs text-muted-foreground">Latest 100 transactions across every type and status.</p>
                  </div>
                  <button type="button" onClick={() => void loadTransactions()} disabled={allTxLoading} className="rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50">{allTxLoading ? "Loading…" : "Reload"}</button>
                </div>
                {allTxError && (<p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">Couldn&apos;t load transactions: {allTxError}</p>)}
              {emailsError && (<p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">Emails unavailable: {emailsError}</p>)}
                <div className="overflow-hidden rounded-2xl border bg-card">
                  <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
                    <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                      <th className="px-4 py-3">Date/Time</th><th className="px-4 py-3">User Email</th><th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Details</th>
                    </tr></thead>
                    <tbody>
                      {allTxLoading && allTransactions.length === 0 && (<tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading transactions…</td></tr>)}
                      {!allTxLoading && allTransactions.length === 0 && (<tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">{allTxError ? "Transactions unavailable." : "No transactions yet."}</td></tr>)}
                      {allTransactions.map((tx) => {
                        const rawAmount = asNumber(tx.amount);
                        // Withdrawals always read as an outflow, even if a row
                        // was stored without the sign.
                        const amount = tx.type === "withdrawal" ? -Math.abs(rawAmount) : rawAmount;
                        const negative = amount < 0;
                        const showsHash = tx.type === "deposit" || tx.type === "withdrawal";
                        return (
                          <tr key={tx.id} className="border-b border-border/40 last:border-0">
                            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDateTime(tx.created_at)}</td>
                            <td className="px-4 py-3 font-medium">{tx.profiles?.email ?? (tx.user_id ? emails[tx.user_id] ?? short(tx.user_id, 10) : "—")}</td>
                            <td className="px-4 py-3">{txTypeLabel(tx.type)}</td>
                            <td className={negative ? "px-4 py-3 font-semibold text-destructive" : "px-4 py-3 font-semibold text-emerald-400"}>{money(amount)}</td>
                            <td className="px-4 py-3"><span className={statusBadgeClass(tx.status)}>{tx.status}</span></td>
                            <td className="px-4 py-3 font-mono text-xs" title={showsHash ? tx.tx_hash ?? "" : undefined}>
                              {showsHash ? (
                                <>
                                  {short(tx.tx_hash, 14)}
                                  {tx.network ? (<span className="ml-2 font-sans text-muted-foreground">{tx.network}</span>) : null}
                                </>
                              ) : (
                                tx.plan_name ?? "—"
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table></div>
                </div>
              </section>
            )}
            {tab === "deposits" && (
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
                          <button type="button" disabled={busyId === tx.id} onClick={() => setConfirmAction({ title: "Approve this deposit?", message: `This credits ${money(Number(tx.deposit_amount ?? tx.amount))} on ${tx.plan_name ?? "the selected plan"}, activates the plan and pays any 10% referral bonus.`, confirmLabel: "Yes, approve deposit", onConfirm: () => approveDeposit(tx) })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busyId === tx.id ? "…" : "Approve"}</button>
                          <button type="button" disabled={busyId === tx.id} onClick={() => setConfirmAction({ title: "Reject this deposit?", message: `The ${money(Number(tx.deposit_amount ?? tx.amount))} deposit will be marked rejected. The user is not credited.`, confirmLabel: "Yes, reject deposit", tone: "danger", onConfirm: () => rejectDeposit(tx) })} className="rounded-lg bg-destructive/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-destructive disabled:opacity-50">Reject</button>
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
                      <th className="px-4 py-3">Balance</th>
                      <th className="px-4 py-3">Net Earned</th>
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
                          <td className="px-4 py-3 font-semibold text-primary">{money(Number(u.main_balance ?? 0) + Number(u.extra_balance ?? 0))}</td>
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
                          <button type="button" disabled={busyId === tx.id} onClick={() => setConfirmAction({ title: "Approve this withdrawal?", message: `This marks ${money(Math.abs(Number(tx.deposit_amount ?? tx.amount)))} as paid out. Make sure the transfer to ${tx.wallet_address ?? "the user's wallet"} was sent.`, confirmLabel: "Yes, approve withdrawal", onConfirm: () => approveWithdrawal(tx) })} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{busyId === tx.id ? "…" : "Approve"}</button>
                          <button type="button" disabled={busyId === tx.id} onClick={() => setConfirmAction({ title: "Reject this withdrawal?", message: `The ${money(Math.abs(Number(tx.amount)))} will be refunded and the user's 7-day cooldown cleared.`, confirmLabel: "Yes, reject + refund", tone: "danger", onConfirm: () => rejectWithdrawal(tx) })} className="rounded-lg bg-destructive/90 px-3 py-1.5 text-xs font-bold text-white hover:bg-destructive disabled:opacity-50">Reject + Refund</button>
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
            {tab === "announcements" && (
              <section className="space-y-6">
                <div className="rounded-2xl border bg-card p-6">
                  <h2 className="font-display text-xl font-bold">Create Announcement</h2>
                  <div className="mt-4 grid gap-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Title</label>
                      <input type="text" value={annTitle} onChange={(e) => setAnnTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" placeholder="Announcement title" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Message</label>
                      <textarea value={annMessage} onChange={(e) => setAnnMessage(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" rows={3} placeholder="Announcement message" />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground">Type</label>
                      <select value={annType} onChange={(e) => setAnnType(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm">
                        <option value="info">info</option>
                        <option value="warning">warning</option>
                        <option value="success">success</option>
                      </select>
                    </div>
                    <button type="button" onClick={() => void createAnnouncement()} disabled={annBusy} className="w-fit rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50">
                      {annBusy ? "Creating…" : "Create"}
                    </button>
                  </div>
                </div>
                <div className="overflow-hidden rounded-2xl border bg-card">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[680px] text-left text-sm">
                      <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                        <th className="px-4 py-3">Title</th><th className="px-4 py-3">Message</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Actions</th>
                      </tr></thead>
                      <tbody>
                        {announcements.length === 0 && (<tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No announcements.</td></tr>)}
                        {announcements.map((a) => (
                          <tr key={a.id} className="border-b border-border/40 last:border-0">
                            <td className="px-4 py-3 font-medium">{a.title}</td>
                            <td className="px-4 py-3 max-w-xs truncate">{a.message}</td>
                            <td className="px-4 py-3">{a.type}</td>
                            <td className="px-4 py-3">{a.is_active ? "Active" : "Inactive"}</td>
                            <td className="px-4 py-3">{new Date(a.created_at).toLocaleDateString()}</td>
                            <td className="px-4 py-3"><div className="flex justify-end gap-2">
                              <button type="button" disabled={busyId === a.id} onClick={() => void toggleAnnouncement(a)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold hover:border-primary hover:text-primary disabled:opacity-50">{a.is_active ? "Deactivate" : "Activate"}</button>
                              <button type="button" disabled={busyId === a.id} onClick={() => void deleteAnnouncement(a)} className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-bold text-destructive-foreground disabled:opacity-50">Delete</button>
                            </div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            )}
            </>
            )}
          </div>
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
                Balance directly edits the user's main balance.
              </p>
              <div className="mt-4 grid gap-4 sm:grid-cols-1">
                <div className="space-y-1.5">
                  <label htmlFor="edit-balance" className="text-sm font-medium">Balance</label>
                  <input id="edit-balance" type="number" min="0" step="0.01" value={editDraft.balance} onChange={(e) => changeBalance(e.target.value)} className="w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
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
                  rows={4}
                  className="min-h-[100px] w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
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

      {/* Plain-state confirmation dialog: approving or rejecting moves real money,
          so nothing runs until the admin confirms it here. */}
      {confirmAction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setConfirmAction(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-confirm-title"
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-glow"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="admin-confirm-title" className="font-display text-lg font-bold">
              {confirmAction.title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{confirmAction.message}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  void action.onConfirm();
                }}
                className={
                  confirmAction.tone === "danger"
                    ? "rounded-lg bg-destructive px-4 py-2 text-sm font-bold text-white hover:bg-destructive/90"
                    : "rounded-lg bg-brand px-4 py-2 text-sm font-bold text-primary-foreground shadow-glow"
                }
              >
                {confirmAction.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

