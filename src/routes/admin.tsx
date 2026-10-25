import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
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

type Tab = "deposits" | "users" | "withdrawals" | "kyc";

const USER_COLS =
  "id,full_name,main_balance,extra_balance,kyc_status,plan_name,plan_started_at,plan_expires_at,is_admin,last_withdraw_at,created_at";
const PLANS = ["Plan 1", "Plan 2", "Plan 3", "Plan 4"] as const;
const KYC_STATUSES = ["unverified", "pending", "verified", "rejected"] as const;

const money = (n: number) => Number(n ?? 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const short = (s: string | null, n = 18) => (!s ? "—" : s.length > n ? `${s.slice(0, n)}…` : s);
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [planUser, setPlanUser] = useState<AdminUser | null>(null);
  const [planPick, setPlanPick] = useState<string>("none");
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editDraft, setEditDraft] = useState({ main: "0", extra: "0", isAdmin: false, kyc: "unverified" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // profiles has no email column, so nothing here selects or embeds it
      // (that used to raise PGRST204 / PGRST200). Emails are resolved from
      // auth.users afterwards through the admin_user_emails() RPC.
      const txCols =
        "id,user_id,type,amount,deposit_amount,plan_name,network,wallet_address,tx_hash,status,created_at";
      const [dep, wd, kyc, userRows] = await Promise.all([
        supabase.from("transactions").select(txCols).eq("type", "deposit").eq("status", "pending").order("created_at"),
        supabase.from("transactions").select(txCols).eq("type", "withdrawal").eq("status", "pending").order("created_at"),
        supabase.from("profiles").select("id,full_name,kyc_status,id_card_url,created_at").eq("kyc_status", "pending").order("created_at"),
        fetchAdminUsers(),
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

  const openEditModal = (user: AdminUser) => {
    setEditDraft({
      main: String(user.main_balance ?? 0),
      extra: String(user.extra_balance ?? 0),
      isAdmin: user.is_admin === true,
      kyc: user.kyc_status ?? "unverified",
    });
    setEditUser(user);
  };

  const saveEdits = async () => {
    if (!editUser) return;
    const target = editUser;
    setBusyUserId(target.id);
    try {
      const main = Number(editDraft.main);
      const extra = Number(editDraft.extra);
      if (!Number.isFinite(main) || main < 0) throw new Error("Main balance must be a number 0 or greater.");
      if (!Number.isFinite(extra) || extra < 0) throw new Error("Extra balance must be a number 0 or greater.");
      const adminId = await assertAdmin();
      if (target.id === adminId && !editDraft.isAdmin) {
        throw new Error("You can't remove your own admin access.");
      }
      const patch = {
        main_balance: round2(main),
        extra_balance: round2(extra),
        is_admin: editDraft.isAdmin,
        kyc_status: editDraft.kyc,
      };
      await updateProfile(target.id, patch, "edit balances/KYC");
      patchUser(target.id, patch);
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
            <div className="overflow-hidden rounded-2xl border bg-card">
              <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm">
                <thead><tr className="border-b border-border/70 text-xs uppercase tracking-widest text-muted-foreground">
                  <th className="px-4 py-3">Email</th><th className="px-4 py-3">Name</th><th className="px-4 py-3">Main Balance</th>
                  <th className="px-4 py-3">Extra Balance</th><th className="px-4 py-3">KYC Status</th><th className="px-4 py-3">Plan Name</th>
                  <th className="px-4 py-3">Account Status</th><th className="px-4 py-3 text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {filteredUsers.length === 0 && (<tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">{users.length === 0 ? "No users yet." : "No users match that search."}</td></tr>)}
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="border-b border-border/40 last:border-0">
                      <td className="px-4 py-3 font-medium">{emails[u.id] ?? short(u.id, 10)}</td>
                      <td className="px-4 py-3">{u.full_name || "—"}</td>
                      <td className="px-4 py-3 font-semibold text-primary">{money(Number(u.main_balance ?? 0))}</td>
                      <td className="px-4 py-3">{money(Number(u.extra_balance ?? 0))}</td>
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
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <button type="button" disabled={busyUserId === u.id} onClick={() => void resetWithdrawLimit(u)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50">Reset Withdraw Limit</button>
                          <button type="button" disabled={busyUserId === u.id} onClick={() => void sendPasswordReset(u)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-bold text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50">Send Reset Password</button>
                          <button type="button" disabled={busyUserId === u.id} onClick={() => void toggleSuspend(u)} className={u.is_suspended ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50" : "rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"}>{u.is_suspended ? "Unhold Account" : "Hold Account"}</button>
                          <button type="button" disabled={busyUserId === u.id} onClick={() => openPlanModal(u)} className="rounded-lg bg-primary/15 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/25 disabled:opacity-50">Manage Plan</button>
                          <button type="button" disabled={busyUserId === u.id} onClick={() => openEditModal(u)} className="rounded-lg border border-primary/40 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/10 disabled:opacity-50">Edit Balances &amp; KYC</button>
                        </div>
                      </td>
                    </tr>
                  ))}
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
              <h2 id="edit-modal-title" className="font-display text-xl font-bold">Edit balances &amp; KYC</h2>
              <p className="mt-1 text-sm text-muted-foreground">{label(editUser)}</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="edit-main" className="text-sm font-medium">Main balance</label>
                  <input id="edit-main" type="number" min="0" step="0.01" value={editDraft.main} onChange={(e) => setEditDraft((d) => ({ ...d, main: e.target.value }))} className="w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="edit-extra" className="text-sm font-medium">Extra balance</label>
                  <input id="edit-extra" type="number" min="0" step="0.01" value={editDraft.extra} onChange={(e) => setEditDraft((d) => ({ ...d, extra: e.target.value }))} className="w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20" />
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
      </main>
    </div>
  );
}

