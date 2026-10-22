import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import { AdsterraBanner } from "@/components/AdsterraBanner";
import { HilltopVideoAd } from "@/components/HilltopVideoAd";
import { KycModal } from "@/components/KycModal";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Roket" },
      { name: "description", content: "Manage your Roket account, referral link, and plans." },
      { property: "og:title", content: "Dashboard — Roket" },
      { property: "og:description", content: "Manage your Roket account, referral link, and plans." },
    ],
  }),
  component: Dashboard,
});

type Profile = Tables<"profiles">;

type AdEarning = {
  id: string;
  amount: number;
  created_at: string;
};

type ReferralMember = {
  id: string;
  full_name: string;
  created_at: string;
};

type ActivePlan = {
  plan_name: string | null;
  amount: number;
  started_at: string;
};

type LatestWithdraw = {
  amount: number;
  created_at: string;
  wallet_address: string | null;
};

type DashboardSummary = {
  adReward: number;
  referralBonus: number;
  totalWithdrawn: number;
  latestWithdraw: LatestWithdraw | null;
  activePlan: ActivePlan | null;
};

const EMPTY_SUMMARY: DashboardSummary = {
  adReward: 0,
  referralBonus: 0,
  totalWithdrawn: 0,
  latestWithdraw: null,
  activePlan: null,
};

const AD_REWARD = 0.05;
const AD_SECONDS = 15;

const PLAN_TOTAL_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

// Mirrors the rates used by public.distribute_daily_profits().
const PLAN_DAILY_RATES: Record<string, number> = {
  "plan 1": 1,
  "plan 2": 3,
  "plan 3": 4.5,
  "plan 4": 8,
};

function planDailyRate(planName: string | null, investment: number): number {
  const key = (planName ?? "").trim().toLowerCase();
  if (PLAN_DAILY_RATES[key] != null) return PLAN_DAILY_RATES[key];
  if (/plan\s*4/.test(key) || investment >= 250) return 8;
  if (/plan\s*3/.test(key) || investment >= 180) return 4.5;
  if (/plan\s*2/.test(key) || investment >= 120) return 3;
  if (/plan\s*1/.test(key) || investment >= 60) return 1;
  return 0;
}

function truncateWallet(address: string | null): string {
  if (!address) return "—";
  const trimmed = address.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const WITHDRAW_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Dashboard() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState("");
  const [refreshingProfile, setRefreshingProfile] = useState(false);
  const requestId = useRef(0);
  const [adOpen, setAdOpen] = useState(false);
  const [adSecondsLeft, setAdSecondsLeft] = useState(AD_SECONDS);
  const [videoDone, setVideoDone] = useState(false);
  const [adClaiming, setAdClaiming] = useState(false);
  const [adEarnings, setAdEarnings] = useState<AdEarning[]>([]);
  const [referrals, setReferrals] = useState<ReferralMember[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawSource, setWithdrawSource] = useState<"main" | "extra">("main");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  // Stable profile fetcher. It lives OUTSIDE the mount effect so the Retry
  // button can call it directly; the effect below only kicks off the first run.
  // requestId drops stale responses when Retry is clicked repeatedly.
  const fetchProfile = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshingProfile(true);
    setProfileError("");

    try {
      const {
        data: { user: currentUser },
        error: userError,
      } = await supabase.auth.getUser();
      if (id !== requestId.current) return;

      if (userError) console.error("[dashboard] auth.getUser failed", userError);
      setUser(currentUser);

      if (!currentUser) {
        setProfile(null);
        setProfileError("You are not signed in. Please log in again.");
        return;
      }

      // The KYC gate depends on this row, so read it before rendering the
      // dashboard (and never open the KYC modal until it has been read).
      const { data, error: profileFetchError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", currentUser.id)
        .maybeSingle();
      if (id !== requestId.current) return;

      console.log("[dashboard] profile fetch", {
        userId: currentUser.id,
        kyc_status: data?.kyc_status ?? null,
        error: profileFetchError?.message ?? null,
      });

      if (profileFetchError) {
        console.error("[dashboard] profile fetch failed", {
          userId: currentUser.id,
          message: profileFetchError.message,
          code: profileFetchError.code,
          details: profileFetchError.details,
          hint: profileFetchError.hint,
        });
        setProfile(null);
        setProfileError(profileFetchError.message);
        return;
      }

      setProfile(data);

      if (!data) {
        // No error but no row: either it does not exist, or RLS is hiding it.
        console.error("[dashboard] profile row missing or not visible", {
          userId: currentUser.id,
          hint: "Check the profiles SELECT policy (auth.uid() = id) and that the row exists.",
        });
        setProfileError(`No profile record is visible for your account (${currentUser.id}).`);
        return;
      }

      // Secondary dashboard data — failures here must not block the page.
      const { data: earnings } = await supabase
        .from("transactions")
        .select("id,amount,created_at")
        .eq("user_id", currentUser.id)
        .eq("type", "ad_earning")
        .order("created_at", { ascending: false })
        .limit(5);
      if (id !== requestId.current) return;
      if (earnings) setAdEarnings(earnings as AdEarning[]);

      const { data: team } = await supabase
        .from("profiles")
        .select("id,full_name,created_at")
        .eq("referred_by", currentUser.id)
        .order("created_at", { ascending: false });
      if (id !== requestId.current) return;
      if (team) setReferrals(team as ReferralMember[]);

      // Aggregates for the top cards. Supabase has no client-side SUM, so the
      // amounts are summed here; failures fall back to empty lists.
      const [adRows, bonusRows, withdrawalRows, depositRows] = await Promise.all([
        supabase
          .from("transactions")
          .select("amount")
          .eq("user_id", currentUser.id)
          .eq("type", "ad_earning"),
        supabase
          .from("transactions")
          .select("amount")
          .eq("user_id", currentUser.id)
          .eq("type", "referral_bonus"),
        supabase
          .from("transactions")
          .select("amount,created_at,wallet_address")
          .eq("user_id", currentUser.id)
          .eq("type", "withdrawal")
          .eq("status", "completed")
          .order("created_at", { ascending: false }),
        supabase
          .from("transactions")
          .select("plan_name,deposit_amount,amount,created_at")
          .eq("user_id", currentUser.id)
          .eq("type", "deposit")
          .eq("status", "completed")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      if (id !== requestId.current) return;

      const sumAmounts = (rows: Array<{ amount: number | string | null }> | null) =>
        (rows ?? []).reduce((total, row) => total + Math.abs(Number(row.amount) || 0), 0);

      const withdrawals = (withdrawalRows.data ?? []) as Array<{
        amount: number | string;
        created_at: string;
        wallet_address: string | null;
      }>;
      const latestDeposit = (depositRows.data ?? [])[0] as
        | {
            plan_name: string | null;
            deposit_amount: number | string | null;
            amount: number | string;
            created_at: string;
          }
        | undefined;

      setSummary({
        adReward: sumAmounts(adRows.data),
        referralBonus: sumAmounts(bonusRows.data),
        totalWithdrawn: sumAmounts(withdrawals),
        latestWithdraw: withdrawals[0]
          ? {
              amount: Math.abs(Number(withdrawals[0].amount) || 0),
              created_at: withdrawals[0].created_at,
              wallet_address: withdrawals[0].wallet_address ?? null,
            }
          : null,
        activePlan: latestDeposit
          ? {
              plan_name: latestDeposit.plan_name,
              amount: Number(latestDeposit.deposit_amount ?? latestDeposit.amount ?? 0),
              started_at: latestDeposit.created_at,
            }
          : null,
      });
    } catch (err) {
      if (id !== requestId.current) return;
      console.error("[dashboard] fetchProfile threw", err);
      setProfileError(err instanceof Error ? err.message : "Couldn't load your profile.");
    } finally {
      if (id === requestId.current) {
        setRefreshingProfile(false);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void fetchProfile();
  }, [fetchProfile]);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/login", replace: true });
  };

  const fullName =
    profile?.full_name ??
    (typeof user?.user_metadata?.["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : "Trader");
  const email = user?.email ?? "";
  // Referral code = user id (short display, full id in link).
  const referralCode = user?.id ? `${user.id.slice(0, 8).toUpperCase()}` : "";
  const referralLink =
    user?.id && typeof window !== "undefined"
      ? `https://roket.bond/signup?ref=${user.id}`
      : "";
  const memberSince = profile?.created_at ?? user?.created_at;
  // The KYC gate is only trustworthy once the profile row has been read:
  // loading === false, no fetch error, and a real row in hand.
  const profileLoaded = !loading && !profileError && profile !== null;
  const kycStatus = profile?.kyc_status ?? null;
  // Normalize so a stored "Verified" / " verified " still counts (the modal
  // normalizes the same way).
  const kycVerified = (kycStatus ?? "").trim().toLowerCase() === "verified";
  const mainBalance = Number(profile?.main_balance ?? 0);
  const extraBalance = Number(profile?.extra_balance ?? 0);

  useEffect(() => {
    if (!adOpen) return;
    setAdSecondsLeft(AD_SECONDS);
    setVideoDone(false);
  }, [adOpen]);

  useEffect(() => {
    if (!adOpen || adSecondsLeft <= 0) return;
    const t = setTimeout(() => setAdSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [adOpen, adSecondsLeft]);

  const openAd = () => {
    setAdSecondsLeft(AD_SECONDS);
    setVideoDone(false);
    setAdOpen(true);
  };

  const closeAd = () => {
    if (adClaiming) return;
    setAdOpen(false);
  };

  const refreshAdEarnings = async (userId: string) => {
    const { data } = await supabase
      .from("transactions")
      .select("id,amount,created_at")
      .eq("user_id", userId)
      .eq("type", "ad_earning")
      .order("created_at", { ascending: false })
      .limit(5);
    if (data) setAdEarnings(data as AdEarning[]);
  };

  const claimAdReward = async () => {
    if (!user || adClaiming || adSecondsLeft > 0 || !videoDone) return;
    setAdClaiming(true);
    try {
      const currentExtra = Number(profile?.extra_balance ?? 0);
      const nextExtra = Math.round((currentExtra + AD_REWARD) * 100) / 100;

      const payload: Record<string, unknown> = {
        user_id: user.id,
        type: "ad_earning",
        amount: AD_REWARD,
        status: "completed",
      };
      let { error: txError } = await supabase.from("transactions").insert(payload);
      // Fallback for DBs where deposit-specific columns are still NOT NULL
      // (migration not run yet): supply benign defaults.
      if (txError && (txError.code === "23502" || /null value/i.test(txError.message))) {
        const retry = await supabase.from("transactions").insert({
          ...payload,
          deposit_amount: AD_REWARD,
          network: "AD",
          plan_name: "Watch Ads",
          wallet_address: "ad-reward",
          tx_hash: `ad-${Date.now()}`,
        });
        txError = retry.error;
      }
      if (txError) throw txError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ extra_balance: nextExtra })
        .eq("id", user.id);
      if (profileError) {
        const msg = /column .*extra_balance/i.test(profileError.message)
          ? "Please run the wallet migration first (extra_balance column missing)."
          : profileError.message;
        throw new Error(msg);
      }

      setProfile((current) =>
        current ? { ...current, extra_balance: nextExtra } : current,
      );
      setSummary((current) => ({
        ...current,
        adReward: Math.round((current.adReward + AD_REWARD) * 100) / 100,
      }));
      await refreshAdEarnings(user.id);
      setAdOpen(false);
      toast.success("+$0.05 Added to Extra Balance");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't claim reward. Try again.";
      toast.error(message);
    } finally {
      setAdClaiming(false);
    }
  };

  const copyReferral = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success("Referral link copied");
    } catch {
      toast.error("Couldn't copy — please copy it manually");
    }
  };

  const totalBalance = mainBalance + extraBalance;

  // Top-card derived values.
  const planStartedAt = profile?.plan_started_at ?? summary.activePlan?.started_at ?? null;
  const activePlanName = summary.activePlan?.plan_name ?? null;
  const investmentAmount = summary.activePlan?.amount ?? 0;
  const planStartedMs = planStartedAt ? new Date(planStartedAt).getTime() : Number.NaN;
  const planExpiresMs = profile?.plan_expires_at
    ? new Date(profile.plan_expires_at).getTime()
    : Number.NaN;
  const planActive =
    Number.isFinite(planStartedMs) &&
    (!Number.isFinite(planExpiresMs) || planExpiresMs > Date.now());
  const dailyEarning = planActive ? planDailyRate(activePlanName, investmentAmount) : 0;
  const planDaysPassed = Number.isFinite(planStartedMs)
    ? Math.min(PLAN_TOTAL_DAYS, Math.max(1, Math.floor((Date.now() - planStartedMs) / DAY_MS) + 1))
    : 0;
  const planProgressPct = (planDaysPassed / PLAN_TOTAL_DAYS) * 100;
  const walletAddress =
    profile?.default_wallet_address || summary.latestWithdraw?.wallet_address || null;

  // Strict dual-ad gate: the reward unlocks only when the 15 second timer has
  // elapsed AND the Hilltop video ad reported that it played to the end.
  const adTimerDone = adSecondsLeft <= 0;
  const canClaimAd = adTimerDone && videoDone;
  const sourceBalance = withdrawSource === "main" ? mainBalance : extraBalance;
  const lastWithdrawAt = profile?.last_withdraw_at
    ? new Date(profile.last_withdraw_at).getTime()
    : null;
  const withdrawCooldownLeftMs =
    lastWithdrawAt != null ? lastWithdrawAt + WITHDRAW_COOLDOWN_MS - Date.now() : 0;
  const withdrawLocked = withdrawCooldownLeftMs > 0;
  const withdrawCooldownDays = withdrawLocked
    ? Math.max(1, Math.ceil(withdrawCooldownLeftMs / (24 * 60 * 60 * 1000)))
    : 0;
  const parsedWithdrawAmount = Number(withdrawAmount);
  const withdrawAmountValid =
    Number.isFinite(parsedWithdrawAmount) &&
    parsedWithdrawAmount > 0 &&
    Math.round(parsedWithdrawAmount * 100) / 100 <= Math.round(sourceBalance * 100) / 100;
  const withdrawBlockedReason = withdrawLocked
    ? `You can withdraw again in ${withdrawCooldownDays} day${withdrawCooldownDays === 1 ? "" : "s"}.`
    : "";

  const openWithdraw = () => {
    setWithdrawAmount("");
    setWithdrawAddress(profile?.default_wallet_address ?? "");
    setWithdrawOpen(true);
  };

  const submitWithdraw = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || withdrawBusy) return;
    const address = withdrawAddress.trim();
    const amount = Math.round(Number(withdrawAmount) * 100) / 100;
    if (withdrawLocked) {
      toast.error(withdrawBlockedReason || "Withdrawals are limited to once every 7 days.");
      return;
    }
    if (!address) {
      toast.error("Enter your crypto wallet address.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid withdrawal amount.");
      return;
    }
    if (amount > Math.round(sourceBalance * 100) / 100) {
      toast.error("Amount exceeds your available balance.");
      return;
    }
    setWithdrawBusy(true);
    try {
      const nowIso = new Date().toISOString();
      const txPayload: Record<string, unknown> = {
        user_id: user.id,
        type: "withdrawal",
        amount: -amount,
        status: "pending",
        wallet_address: address,
      };
      let { error: txError } = await supabase.from("transactions").insert(txPayload);
      if (txError && (txError.code === "23502" || /null value/i.test(txError.message))) {
        const retry = await supabase.from("transactions").insert({
          ...txPayload,
          deposit_amount: amount,
          network: "WITHDRAW",
          plan_name: withdrawSource === "main" ? "Main Balance" : "Extra Balance",
          tx_hash: `wd-${Date.now()}`,
        });
        txError = retry.error;
      }
      if (txError) throw txError;

      const balancePatch =
        withdrawSource === "main"
          ? { main_balance: Math.round((mainBalance - amount) * 100) / 100 }
          : { extra_balance: Math.round((extraBalance - amount) * 100) / 100 };
      const { error: profileError } = await supabase
        .from("profiles")
        .update({
          ...balancePatch,
          last_withdraw_at: nowIso,
          default_wallet_address: address,
        })
        .eq("id", user.id);
      if (profileError) {
        const msg = /column .*last_withdraw_at/i.test(profileError.message)
          ? "Please run the withdrawal migration first (last_withdraw_at column missing)."
          : /column .*default_wallet_address/i.test(profileError.message)
            ? "Please run the dashboard profile migration first (default_wallet_address missing)."
            : profileError.message;
        throw new Error(msg);
      }

      setProfile((current) =>
        current
          ? {
              ...current,
              ...balancePatch,
              last_withdraw_at: nowIso,
              default_wallet_address: address,
            }
          : current,
      );
      setWithdrawOpen(false);
      setWithdrawAddress("");
      setWithdrawAmount("");
      toast.success("Withdrawal request submitted for manual review.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't submit withdrawal.";
      toast.error(message);
    } finally {
      setWithdrawBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/">
            <img src="/logo.png" alt="Roket" className="h-9" />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {user && (
        <KycModal
          open={profileLoaded && !kycVerified}
          userId={user.id}
          defaultName={fullName === "Trader" ? "" : fullName}
          kycStatus={kycStatus}
          idCardUrl={profile?.id_card_url ?? null}
          onSubmitted={(patch) =>
            setProfile((current) => (current ? { ...current, ...patch } : current))
          }
          onVerified={(nextProfile) =>
            setProfile((current) => (current ? { ...current, ...nextProfile } : nextProfile))
          }
        />
      )}

      <main className="mx-auto max-w-5xl px-4 py-10">
        {!loading && !profileLoaded && (
          <div className="mb-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">We couldn't load your profile.</p>
            <p className="mt-1 text-muted-foreground">
              {profileError ||
                "Your profile record is missing, so your KYC status can't be confirmed."}
            </p>
            <button
              type="button"
              onClick={() => void fetchProfile()}
              disabled={refreshingProfile}
              className="mt-3 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshingProfile ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
          </div>
        ) : (
          <>
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                Dashboard
              </p>
              <h1 className="mt-2 font-display text-4xl font-bold">Welcome back, {fullName}</h1>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                Your account is ready. Choose a plan, submit your deposit, and our team will verify
                it manually.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {email ? `${email} · ` : ""}
                Member since {formatDay(memberSince ?? null)} · KYC{" "}
                {kycVerified ? "verified" : kycStatus || "required"}
              </p>
            </section>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Total Balance
                  </p>
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                    Live
                  </span>
                </div>
                <p className="mt-3 font-display text-3xl font-bold text-white">
                  {money(Number.isFinite(totalBalance) ? totalBalance : 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Main {money(mainBalance)} · Extra {money(extraBalance)}
                </p>
                <dl className="mt-4 space-y-2 border-t border-gray-800 pt-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Daily Earning</dt>
                    <dd
                      className={
                        dailyEarning > 0
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-muted-foreground"
                      }
                    >
                      {dailyEarning > 0 ? `+${money(dailyEarning)} / day` : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Ads Reward</dt>
                    <dd
                      className={
                        summary.adReward > 0
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-muted-foreground"
                      }
                    >
                      {summary.adReward > 0 ? `+${money(summary.adReward)}` : money(0)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Referral Bonus</dt>
                    <dd
                      className={
                        summary.referralBonus > 0
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-muted-foreground"
                      }
                    >
                      {summary.referralBonus > 0 ? `+${money(summary.referralBonus)}` : money(0)}
                    </dd>
                  </div>
                </dl>
              </section>

              <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Your Plan</p>
                <p className="mt-3 font-display text-2xl font-bold text-white">
                  {activePlanName ?? "No active plan"}
                </p>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Plan Started</dt>
                    <dd className="font-medium text-foreground">{formatDay(planStartedAt)}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Investment</dt>
                    <dd className="font-medium text-foreground">{money(investmentAmount)}</dd>
                  </div>
                </dl>
                <div className="mt-4 border-t border-gray-800 pt-4">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Plan progress</span>
                    <span className="font-semibold text-foreground">
                      Day {planDaysPassed} / {PLAN_TOTAL_DAYS}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="Plan progress"
                    aria-valuemin={0}
                    aria-valuemax={PLAN_TOTAL_DAYS}
                    aria-valuenow={planDaysPassed}
                    className="mt-2 h-2 overflow-hidden rounded-full bg-gray-800"
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-700"
                      style={{ width: `${planProgressPct}%` }}
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Withdrawals
                </p>
                <p className="mt-3 font-display text-3xl font-bold text-white">
                  {money(summary.totalWithdrawn)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Total withdrawn</p>
                <dl className="mt-4 space-y-2 border-t border-gray-800 pt-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Latest Withdraw</dt>
                    <dd className="text-right">
                      <span className="block font-semibold text-foreground">
                        {summary.latestWithdraw ? money(summary.latestWithdraw.amount) : "—"}
                      </span>
                      {summary.latestWithdraw && (
                        <span className="block text-[11px] text-muted-foreground">
                          {formatDay(summary.latestWithdraw.created_at)}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Wallet</dt>
                    <dd
                      className="font-mono text-xs font-semibold text-foreground"
                      title={walletAddress ?? undefined}
                    >
                      {truncateWallet(walletAddress)}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            <section className="mt-6 rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Your referral code
                  </p>
                  <p className="mt-2 font-display text-2xl font-bold tracking-[0.15em] text-primary">
                    {referralCode || user?.id?.slice(0, 8).toUpperCase() || "—"}
                  </p>
                  {referralLink && (
                    <code className="mt-2 block break-all rounded-lg border bg-muted px-3 py-2 text-xs text-muted-foreground">
                      {referralLink}
                    </code>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Share this link — new signups credit you as referrer.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={copyReferral}
                  disabled={!referralLink}
                  className="rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Copy link
                </button>
              </div>
              <div className="mt-4 rounded-xl border border-border/60 bg-background/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    My Referrals ({referrals.length})
                  </p>
                  <p className="text-xs text-muted-foreground">
                    10% deposit bonus lands here after admin approval (coming next).
                  </p>
                </div>
                {referrals.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    No referrals yet. Share your link above to grow your team.
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border/60">
                    {referrals.map((member) => (
                      <li key={member.id} className="flex items-center justify-between py-2 text-sm">
                        <span className="font-medium">{member.full_name || "Member"}</span>
                        <span className="text-muted-foreground">
                          {new Date(member.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="mt-6 rounded-2xl border border-fuchsia-500/40 bg-card p-6 shadow-glow">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="text-xs uppercase tracking-widest text-fuchsia-300">
                    Extra Income
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold">
                    Watch Ads &amp; Earn
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    Watch a 15-second ad and claim $0.05 to your Extra Balance.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openAd}
                  className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-105"
                >
                  Watch Ads
                </button>
              </div>
            <div className="mt-4 rounded-xl border border-border/60 bg-background/60 p-4">
              <p className="text-xs uppercase tracking-widest text-muted-foreground">
                Recent ad earnings
              </p>
              {adEarnings.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No ad earnings yet. Watch your first ad to earn $0.05.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border/60">
                  {adEarnings.map((row) => (
                    <li key={row.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-muted-foreground">
                        {new Date(row.created_at).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      <span className="font-display font-bold text-emerald-500">
                        +{money(Number(row.amount) || 0)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </section>

            <section className="mt-6 rounded-2xl border border-emerald-500/40 bg-card p-6 shadow-glow">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="text-xs uppercase tracking-widest text-emerald-300">
                    Withdraw
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold">
                    Withdraw Funds
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    Total available {money(totalBalance)} (Main {money(mainBalance)} + Extra{" "}
                    {money(extraBalance)}). One withdrawal every 7 days, manual review.
                  </p>
                  {withdrawLocked && (
                    <p className="mt-2 text-sm font-semibold text-amber-500">
                      {withdrawBlockedReason}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={openWithdraw}
                  className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-105"
                >
                  Withdraw
                </button>
              </div>
            </section>

            <section className="mt-6 rounded-2xl border border-primary/40 bg-card p-6 shadow-glow">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Next step
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold">
                    Choose a plan to start earning
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    Pick a plan and submit your deposit. Payments are reviewed manually.
                  </p>
                </div>
                <Link
                  to="/"
                  hash="pricing"
                  className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground"
                >
                  Browse plans
                </Link>
              </div>
            </section>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <section className="rounded-2xl border bg-card p-5">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Deposit status
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  After you submit a transaction hash, it stays pending until an admin confirms it
                  on-chain.
                </p>
              </section>
              <section className="rounded-2xl border bg-card p-5">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Need help?
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Reach out through the support links in the footer if your deposit takes longer
                  than usual.
                </p>
              </section>
            </div>
          </>
        )}
      </main>

      {withdrawOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdraw-title"
            className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-glow"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                  Withdraw
                </p>
                <h2 id="withdraw-title" className="mt-1 font-display text-xl font-bold">
                  Request Withdrawal
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Main {money(mainBalance)} · Extra {money(extraBalance)} · Total{" "}
                  {money(totalBalance)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !withdrawBusy && setWithdrawOpen(false)}
                disabled={withdrawBusy}
                aria-label="Close withdrawal"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitWithdraw} className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="tablist">
                {(["main", "extra"] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={withdrawSource === key}
                    onClick={() => setWithdrawSource(key)}
                    className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${withdrawSource === key ? "bg-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {key === "main" ? `Main (${money(mainBalance)})` : `Extra (${money(extraBalance)})`}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="withdraw-address" className="text-sm font-medium">
                  Crypto Wallet Address
                </label>
                <input
                  id="withdraw-address"
                  value={withdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                  placeholder="Paste your wallet address"
                  className="w-full rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="withdraw-amount" className="text-sm font-medium">
                  Withdrawal Amount (USD)
                </label>
                <input
                  id="withdraw-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Available from {withdrawSource}: {money(sourceBalance)}
                </p>
              </div>

              {withdrawBlockedReason && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-500">
                  {withdrawBlockedReason}
                </p>
              )}

              <button
                type="submit"
                disabled={withdrawBusy || withdrawLocked || !withdrawAmountValid || !withdrawAddress.trim()}
                className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              >
                {withdrawBusy ? "Submitting…" : "Submit Withdrawal"}
              </button>
              <p className="text-center text-xs text-muted-foreground">
                One withdrawal every 7 days. Requests need manual review.
              </p>
            </form>
          </div>
        </div>
      )}

      {adOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/70 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="watch-ad-title"
            className="my-auto max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border bg-card p-5 shadow-glow sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                  Watch &amp; Earn
                </p>
                <h2 id="watch-ad-title" className="mt-1 font-display text-xl font-bold">
                  Watch Ads &amp; Earn $0.05
                </h2>
              </div>
              <button
                type="button"
                onClick={closeAd}
                disabled={adClaiming}
                aria-label="Close ad"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <section>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
                  Sponsored
                </p>
                <HilltopVideoAd onAdCompleted={() => setVideoDone(true)} />
                <p
                  className={`mt-1.5 text-[11px] ${
                    videoDone ? "text-emerald-500" : "text-muted-foreground"
                  }`}
                >
                  {videoDone
                    ? "Video ad completed ✓"
                    : "Watch the video to the end to unlock your reward."}
                </p>
              </section>

              <section className="overflow-hidden rounded-xl border border-border/60">
                <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
                    Sponsored
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Image ad
                  </p>
                </div>
                <div className="bg-background">
                  <AdsterraBanner />
                </div>
              </section>

              <p className="text-center text-xs text-muted-foreground">
                Complete both ads to claim your reward.
              </p>
            </div>

            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-brand transition-all duration-1000"
                style={{ width: `${((AD_SECONDS - adSecondsLeft) / AD_SECONDS) * 100}%` }}
              />
            </div>

            <div className="mt-3 text-center">
              {canClaimAd ? (
                <button
                  type="button"
                  onClick={claimAdReward}
                  disabled={adClaiming}
                  className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {adClaiming ? "Claiming…" : "Claim $0.05"}
                </button>
              ) : adTimerDone ? (
                <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                  Finish the video ad to unlock your reward.
                </p>
              ) : (
                <p className="font-display text-4xl font-bold text-primary">{adSecondsLeft}s</p>
              )}
              <p className="mt-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                {canClaimAd
                  ? "reward ready"
                  : adTimerDone
                    ? "video ad required"
                    : "seconds remaining"}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
