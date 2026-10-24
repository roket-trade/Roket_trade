import { useCallback, useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import type { ApexOptions } from "apexcharts";
import {
  Bell,
  Gift,
  Lock,
  Mail,
  Pencil,
  Send,
  Ticket,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { AdsterraBanner } from "@/components/AdsterraBanner";
import { HilltopVideoAd } from "@/components/HilltopVideoAd";
import { KycModal } from "@/components/KycModal";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { createPlatformStats } from "@/lib/platform-stats";
import type { PlatformStats } from "@/lib/platform-stats";
import { PAYMENT_VERIFICATION_EVENT } from "@/lib/payment-verification";
import { buildReferralLink } from "@/lib/referral";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Roket" },
      { name: "description", content: "Manage your Roket account, referral link, and plans." },
      { property: "og:title", content: "Dashboard — Roket" },
      {
        property: "og:description",
        content: "Manage your Roket account, referral link, and plans.",
      },
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
  /** Total 10% bonuses earned from this referred user (0 when none yet). */
  bonus: number;
};

type ReferralBonusRow = {
  amount: number | string | null;
  created_at: string;
  /** Added by the referral-bonus migration; absent on legacy rows. */
  referred_user_id?: string | null;
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

type RecentWithdrawal = {
  id: string;
  amount: number | string;
  created_at: string;
  status: string | null;
};

type DashboardSummary = {
  adReward: number;
  referralBonus: number;
  dailyProfit: number;
  totalWithdrawn: number;
  latestWithdraw: LatestWithdraw | null;
  activePlan: ActivePlan | null;
  totalDeposited: number;
  totalPendingWithdrawals: number;
};

const EMPTY_SUMMARY: DashboardSummary = {
  adReward: 0,
  referralBonus: 0,
  dailyProfit: 0,
  totalWithdrawn: 0,
  latestWithdraw: null,
  activePlan: null,
  totalDeposited: 0,
  totalPendingWithdrawals: 0,
};

type WalletType = "bep20" | "solana" | "trc20";

const WALLET_LABELS: Record<WalletType, string> = {
  bep20: "BEP20",
  solana: "Solana",
  trc20: "TRC20",
};

type SavedWallets = {
  bep20?: string | null;
  solana?: string | null;
  trc20?: string | null;
};

/** Show only the first 4 and last 4 characters of a wallet address. */
function maskWallet(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length <= 8) return trimmed;
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

const WALLET_TYPES: WalletType[] = ["bep20", "solana", "trc20"];

/** Return the saved wallets that actually have an address, in a fixed order. */
function walletOptions(
  wallets: SavedWallets | undefined,
): Array<{ type: WalletType; address: string }> {
  const types: WalletType[] = ["bep20", "solana", "trc20"];
  return types
    .map((type) => ({ type, address: String(wallets?.[type] ?? "") }))
    .filter((o) => o.address.trim().length > 0);
}

/** Sum every completed deposit for the user (their total placed capital). */
function sumDeposits(
  rows: Array<{ deposit_amount?: number | string | null }> | null,
): number {
  return (rows ?? []).reduce(
    (total, row) => total + (Number(row.deposit_amount ?? 0) || 0),
    0,
  );
}

type Candle = {
  x: number;
  y: [number, number, number, number];
};

const PLATFORM_PROFIT_ROWS: Array<[keyof PlatformStats, string]> = [
  ["today", "Today Platform Profit"],
  ["week", "This Week Platform Profit"],
  ["month", "This Month Platform Profit"],
];

const PLATFORM_LOSS_ROWS: Array<[keyof PlatformStats, string]> = [
  ["today", "Today Platform Loss"],
  ["week", "This Week Platform Loss"],
  ["month", "This Month Platform Loss"],
];

const EMPTY_PLATFORM_STATS: PlatformStats = {
  today: { profit: 0, loss: 0 },
  week: { profit: 0, loss: 0 },
  month: { profit: 0, loss: 0 },
};

const START_PRICE = 24_500;
const CANDLE_COUNT = 56;
const CANDLE_STEP_MS = 60_000;
const CHART_TICK_MS = 3000;
const TICKS_PER_CANDLE = CANDLE_STEP_MS / CHART_TICK_MS;

function makeCandle(open: number, time: number): Candle {
  const close = Math.max(100, open + (Math.random() - 0.48) * 180);
  const wick = Math.max(12, open * 0.0006) * (0.4 + Math.random());
  const high = Math.max(open, close) + wick * Math.random();
  const low = Math.max(1, Math.min(open, close) - wick * Math.random());
  return {
    x: time,
    y: [round2(open), round2(high), round2(low), round2(close)],
  };
}

function seedCandles(): Candle[] {
  const now = Date.now();
  const candles: Candle[] = [];
  let price = START_PRICE;
  for (let index = CANDLE_COUNT - 1; index >= 0; index -= 1) {
    const candle = makeCandle(price, now - index * CANDLE_STEP_MS);
    candles.push(candle);
    price = candle.y[3];
  }
  return candles;
}

const CANDLE_CHART_OPTIONS: ApexOptions = {
  chart: {
    type: "candlestick",
    background: "transparent",
    toolbar: { show: false },
    zoom: { enabled: false },
    animations: { enabled: true, dynamicAnimation: { enabled: true, speed: 300 } },
    foreColor: "#94a3b8",
  },
  theme: { mode: "dark" },
  grid: {
    borderColor: "#1f2937",
    strokeDashArray: 4,
    padding: { left: 0, right: 6 },
  },
  plotOptions: {
    candlestick: {
      colors: { upward: "#34d399", downward: "#f43f5e" },
      wick: { useFillColor: true },
    },
  },
  stroke: { width: 1 },
  dataLabels: { enabled: false },
  xaxis: {
    type: "datetime",
    axisBorder: { show: false },
    axisTicks: { show: false },
    labels: {
      style: { colors: "#64748b", fontSize: "10px" },
      datetimeUTC: false,
    },
    tooltip: { enabled: false },
  },
  yaxis: {
    labels: {
      style: { colors: "#64748b", fontSize: "10px" },
      formatter: (value: number) => `$${Math.round(value).toLocaleString("en-US")}`,
    },
  },
  tooltip: { theme: "dark", x: { format: "HH:mm:ss" } },
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

// Ads rewards unlock from Plan 2 upward; Plan 1 and no plan stay locked.
const ADS_ELIGIBLE_PLANS = ["plan 2", "plan 3", "plan 4"];

function isAdsEligible(planName: string | null | undefined): boolean {
  const key = (planName ?? "").trim().toLowerCase();
  return ADS_ELIGIBLE_PLANS.includes(key);
}

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
const HOLD_SECONDS_MS = 3000;
const HOLD_TICK_MS = 50;

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const round2 = (n: number) => Math.round(n * 100) / 100;

type ApexChartComponent = typeof import("react-apexcharts").default;

/**
 * Client-side simulated candlestick market. ApexCharts is loaded lazily so
 * the SSR bundle never touches browser-only code. One live candle is updated
 * every few seconds and a new one opens each minute.
 */
function LiveMarketChart() {
  const [Chart, setChart] = useState<ApexChartComponent | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const ticksInCandle = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void import("react-apexcharts").then((module) => {
      // Functional update keeps React from invoking the component as an updater.
      if (!cancelled) setChart(() => module.default);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setCandles(seedCandles());

    const timer = setInterval(() => {
      setCandles((current) => {
        if (!current.length) return current;

        const next = current.slice();
        const last = next[next.length - 1];
        if (!last) return current;

        const [open, high, low, close] = last.y;
        const nextClose = round2(Math.max(100, close + (Math.random() - 0.48) * 60));

        next[next.length - 1] = {
          x: last.x,
          y: [open, round2(Math.max(high, nextClose)), round2(Math.min(low, nextClose)), nextClose],
        };

        ticksInCandle.current += 1;
        if (ticksInCandle.current >= TICKS_PER_CANDLE) {
          ticksInCandle.current = 0;
          next.push(makeCandle(nextClose, last.x + CANDLE_STEP_MS));
          if (next.length > CANDLE_COUNT) next.shift();
        }
        return next;
      });
    }, CHART_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  return (
    <div
      className="mt-4 h-56 w-full sm:h-64"
      role="img"
      aria-label="Live Roket market candlestick chart"
    >
      {Chart && candles.length > 0 ? (
        <Chart
          type="candlestick"
          height="100%"
          width="100%"
          options={CANDLE_CHART_OPTIONS}
          series={[{ data: candles }]}
        />
      ) : (
        <div className="h-full w-full animate-pulse rounded-xl bg-gray-800/40" />
      )}
    </div>
  );
}

function PlatformProfitLossPanel({ stats }: { stats: PlatformStats }) {
  return (
    <div className="mt-5 grid gap-4 border-t border-gray-800 pt-5 sm:grid-cols-2">
      <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Platform Profit
          </p>
          <TrendingUp className="h-4 w-4 text-emerald-400" aria-hidden="true" />
        </div>
        <dl className="mt-3 space-y-2.5 text-sm">
          {PLATFORM_PROFIT_ROWS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-display font-bold text-emerald-400">
                +{money(stats[key].profit)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="rounded-xl border border-rose-500/15 bg-rose-500/[0.04] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-rose-400">
            Platform Loss
          </p>
          <TrendingDown className="h-4 w-4 text-rose-400" aria-hidden="true" />
        </div>
        <dl className="mt-3 space-y-2.5 text-sm">
          {PLATFORM_LOSS_ROWS.map(([key, label]) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-display font-bold text-rose-400">-{money(stats[key].loss)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function AdsRewardCard({
  earnings,
  onWatchAds,
  eligible,
}: {
  earnings: AdEarning[];
  onWatchAds: () => void;
  eligible: boolean;
}) {
  return (
    <section
      data-testid="ads-reward-card"
      className="relative rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur"
    >
      <div
        className={eligible ? undefined : "pointer-events-none select-none opacity-50 blur-sm"}
        aria-hidden={!eligible}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-400">
            Ads Reward
          </h2>
          <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
            Earn
          </span>
        </div>

        <button
          type="button"
          onClick={onWatchAds}
          disabled={!eligible}
          className="mt-4 w-full rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2.5 text-sm font-bold text-gray-950 shadow-[0_0_20px_rgba(52,211,153,0.35)] transition hover:brightness-110"
        >
          Watch Ads
        </button>

        <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Latest 5 Rewards
        </p>
        <ul className="mt-2 divide-y divide-gray-800">
          {earnings.length === 0 ? (
            <li className="py-3 text-xs text-muted-foreground">
              No rewards yet — watch your first ad.
            </li>
          ) : (
            earnings.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-xs">
                <span className="text-muted-foreground">
                  {new Date(row.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <span className="font-semibold text-emerald-400">
                  +{money(Number(row.amount) || 0)}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>

      {!eligible && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-2xl bg-gray-950/70 px-4 text-center backdrop-blur-[2px]">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 shadow-[0_0_20px_rgba(52,211,153,0.25)]">
            <Lock className="h-5 w-5 text-emerald-400" aria-hidden="true" />
          </span>
          <p className="max-w-[15rem] text-xs font-medium leading-relaxed text-gray-200">
            Upgrade to Plan 2 or higher to unlock Ads Rewards.
          </p>
          <Link
            to="/"
            hash="pricing"
            className="rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-4 py-2 text-sm font-bold text-gray-950 shadow-[0_0_20px_rgba(52,211,153,0.35)] transition hover:brightness-110"
          >
            Upgrade Plan
          </Link>
        </div>
      )}
    </section>
  );
}

function ReferralCard({
  code,
  link,
  referrals,
  onCopyCode,
  onCopyLink,
}: {
  code: string;
  link: string;
  referrals: ReferralMember[];
  onCopyCode: () => void;
  onCopyLink: () => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-400">Referral</h2>
        <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
          10%
        </span>
      </div>

      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Your code
      </p>
      <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
        <span className="font-mono text-sm font-bold text-emerald-400">{code || "—"}</span>
        <button
          type="button"
          onClick={onCopyCode}
          disabled={!code}
          className="rounded-md border border-gray-700 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-300 transition hover:border-emerald-400 hover:text-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Copy
        </button>
      </div>
      <p className="mt-2 break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
        {link || "—"}
      </p>

      <button
        type="button"
        onClick={onCopyLink}
        disabled={!link}
        className="mt-2 w-full rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400 transition hover:border-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Copy Link
      </button>

      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Latest 5 Referrals
      </p>
      <ul className="mt-2 divide-y divide-gray-800">
        {referrals.length === 0 ? (
          <li className="py-3 text-xs text-muted-foreground">No referrals yet.</li>
        ) : (
          referrals.map((member) => (
            <li key={member.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <span className="truncate text-foreground">{member.full_name || "Member"}</span>
              <span className="flex shrink-0 items-center gap-2">
                {member.bonus > 0 ? (
                  <span className="font-semibold text-emerald-400">+{money(member.bonus)}</span>
                ) : (
                  <span className="font-semibold text-muted-foreground">+$0.00</span>
                )}
                <span className="text-[10px] text-muted-foreground">
                  {new Date(member.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </span>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function WithdrawCard({
  available,
  withdrawals,
  locked,
  lockedReason,
  onWithdrawal,
  onSetWallet,
}: {
  available: number;
  withdrawals: RecentWithdrawal[];
  locked: boolean;
  lockedReason: string;
  onWithdrawal: () => void;
  onSetWallet: () => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-400">Withdraw</h2>
        <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
          7d
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onWithdrawal}
          className="rounded-xl bg-gradient-to-r from-blue-500 to-emerald-400 px-3 py-2.5 text-xs font-bold text-gray-950 shadow-[0_0_18px_rgba(59,130,246,0.3)] transition hover:brightness-110"
        >
          Withdraw
        </button>
        <button
          type="button"
          onClick={onSetWallet}
          className="rounded-xl border border-blue-500/40 px-3 py-2.5 text-xs font-semibold text-blue-300 transition hover:bg-blue-500/10"
        >
          Set Wallet
        </button>
      </div>

      <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Available Balance
        </p>
        <p className="mt-1 font-display text-2xl font-bold text-emerald-400">{money(available)}</p>
      </div>

      {locked && lockedReason ? (
        <p className="mt-2 text-[11px] font-semibold text-amber-500">{lockedReason}</p>
      ) : null}

      <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Latest 5 Withdrawals
      </p>
      <ul className="mt-2 divide-y divide-gray-800">
        {withdrawals.length === 0 ? (
          <li className="py-3 text-xs text-muted-foreground">No withdrawals yet.</li>
        ) : (
          withdrawals.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-2 py-2 text-xs">
              <span className="text-muted-foreground">
                {new Date(row.created_at).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <span className="font-semibold text-rose-400">
                -{money(Math.abs(Number(row.amount) || 0))}
              </span>
            </li>
          ))
        )}
      </ul>

      <p className="mt-3 text-[10px] text-muted-foreground">One withdrawal every 7 days.</p>
    </section>
  );
}

function UserControlCard({
  email,
  phone,
  planName,
  deposit,
  dailyProfit,
  totalProfit,
  duration,
  kycVerified,
  onChangePassword,
  onEditPhone,
  onCancelPlan,
  onLogout,
}: {
  email: string;
  phone: string | null;
  planName: string | null;
  deposit: number;
  dailyProfit: number;
  totalProfit: number;
  duration: string;
  kycVerified: boolean;
  onChangePassword: () => void;
  onEditPhone: () => void;
  onCancelPlan: () => void;
  onLogout: () => void;
}) {
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-blue-400">
          User Control
        </h2>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <span
            className={
              kycVerified
                ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400"
                : "rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400"
            }
          >
            {kycVerified ? "KYC Verified" : "KYC Pending"}
          </span>
          <span className="rounded-full border border-blue-500/25 bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-300">
            Account
          </span>
        </div>
      </div>

      <dl className="mt-4 space-y-3 text-xs">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Email
          </dt>
          <dd className="mt-0.5 truncate text-foreground">{email || "—"}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Phone Number
          </dt>
          <dd className="mt-0.5 flex items-center justify-between gap-2">
            <span className="truncate text-foreground">{phone?.trim() || "Not set"}</span>
            <button
              type="button"
              onClick={onEditPhone}
              aria-label="Edit phone number"
              className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-gray-700 text-muted-foreground transition hover:border-primary hover:text-primary"
            >
              <Pencil className="h-3 w-3" aria-hidden="true" />
            </button>
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded-lg border border-gray-800 bg-gray-950/50 p-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Plan Summary
        </p>
        <dl className="mt-2 space-y-1.5 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Plan</dt>
            <dd className="font-semibold text-foreground">{planName ?? "No active plan"}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Deposit</dt>
            <dd className="font-semibold text-foreground">{money(deposit)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Daily Profit</dt>
            <dd className="font-semibold text-emerald-400">+{money(dailyProfit)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Total Profit</dt>
            <dd className="font-semibold text-emerald-400">+{money(totalProfit)}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="font-semibold text-foreground">{duration}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 space-y-2">
        <Link
          to="/"
          hash="pricing"
          className="block rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-400 px-3 py-2 text-center text-xs font-bold text-gray-950 shadow-[0_0_18px_rgba(52,211,153,0.3)] transition hover:brightness-110"
        >
          Upgrade Plan
        </Link>
        <button
          type="button"
          onClick={onChangePassword}
          className="w-full rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Change Pass
        </button>
        <button
          type="button"
          onClick={onCancelPlan}
          className="w-full rounded-xl border border-rose-500/50 px-3 py-2 text-xs font-semibold text-rose-400 transition hover:bg-rose-500/10"
        >
          Cancel Plan
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="w-full rounded-xl border border-gray-700 px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
        >
          Logout
        </button>
      </div>
    </section>
  );
}

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
  const [recentWithdrawals, setRecentWithdrawals] = useState<RecentWithdrawal[]>([]);
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  const [platformStats, setPlatformStats] = useState<PlatformStats>(EMPTY_PLATFORM_STATS);
  const [withdrawalOpen, setWithdrawalOpen] = useState(false);
  const [withdrawalBusy, setWithdrawalBusy] = useState(false);
  const [withdrawalSuccess, setWithdrawalSuccess] = useState(false);
  const [submissionDone, setSubmissionDone] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<{
    type: WalletType;
    address: string;
  } | null>(null);
  const [holdActive, setHoldActive] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const [holdTimer, setHoldTimer] = useState<ReturnType<typeof setInterval> | null>(
    null,
  );
  const [holdStartTime, setHoldStartTime] = useState<number | null>(null);

  const [walletManagementOpen, setWalletManagementOpen] = useState(false);
  const [savedWallets, setSavedWallets] = useState<{
    bep20: string;
    solana: string;
    trc20: string;
  }>({ bep20: "", solana: "", trc20: "" });
  const [defaultWalletType, setDefaultWalletType] = useState<WalletType>("bep20");
  const [walletBusy, setWalletBusy] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);

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

      // Referral bonuses are attributed to the referred user through
      // transactions.referred_user_id (added by the referral-bonus migration).
      // A database that has not run it yet rejects that column, so fall back to
      // the legacy column set instead of blanking the referral card.
      const loadReferralBonuses = async (): Promise<ReferralBonusRow[]> => {
        const withLink = await supabase
          .from("transactions")
          .select("amount,created_at,referred_user_id")
          .eq("user_id", currentUser.id)
          .eq("type", "referral_bonus");
        if (!withLink.error) return (withLink.data ?? []) as ReferralBonusRow[];

        const missingColumn = withLink.error.code === "42703" || withLink.error.code === "PGRST204";
        if (!missingColumn) {
          console.error("[dashboard] referral bonus fetch failed", {
            message: withLink.error.message,
            code: withLink.error.code,
          });
          return [];
        }

        const legacy = await supabase
          .from("transactions")
          .select("amount,created_at")
          .eq("user_id", currentUser.id)
          .eq("type", "referral_bonus");
        if (legacy.error) {
          console.error("[dashboard] referral bonus fetch failed", {
            message: legacy.error.message,
            code: legacy.error.code,
          });
          return [];
        }
        return (legacy.data ?? []) as ReferralBonusRow[];
      };

      // Secondary dashboard data — failures here must not block the page.
      // All recent-list queries + aggregates run in one parallel batch.
      const [
        adRows,
        bonusRows,
        withdrawalRows,
        depositRows,
        pendingWithdrawalRows,
        adEarningsRows,
        referralRows,
        recentWithdrawalRows,
        dailyProfitRows,
      ] = await Promise.all([
        supabase
          .from("transactions")
          .select("amount")
          .eq("user_id", currentUser.id)
          .eq("type", "ad_earning"),
        loadReferralBonuses(),
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
          .order("created_at", { ascending: false }),
        supabase
          .from("transactions")
          .select("amount")
          .eq("user_id", currentUser.id)
          .eq("type", "withdrawal")
          .eq("status", "pending")
          .order("created_at", { ascending: false }),
        supabase
          .from("transactions")
          .select("id,amount,created_at")
          .eq("user_id", currentUser.id)
          .eq("type", "ad_earning")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("profiles")
          .select("id,full_name,created_at")
          .eq("referred_by", currentUser.id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("transactions")
          .select("id,amount,created_at,status")
          .eq("user_id", currentUser.id)
          .eq("type", "withdrawal")
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("transactions")
          .select("amount")
          .eq("user_id", currentUser.id)
          .eq("type", "daily_profit"),
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

      const totalDeposited = round2(sumDeposits(depositRows.data));
      const totalPendingWithdrawals = round2(
        sumAmounts(pendingWithdrawalRows.data),
      );

      const dailyProfitTotal = round2(
        Math.max(
          0,
          (dailyProfitRows.data ?? []).reduce(
            (total, row) =>
              total + Number((row as { amount?: number | string | null }).amount ?? 0),
            0,
          ),
        ),
      );

      const referralBonuses = bonusRows ?? [];

      // Group the 10% bonuses by the referred user they came from. Rows that
      // predate transactions.referred_user_id are unlinked; they still count
      // toward the Referral Bonus total (the migration backfills the
      // unambiguous ones) but are not attributed to a name here.
      const bonusByReferredUser = new Map<string, number>();
      for (const row of referralBonuses) {
        const amount = Math.abs(Number(row.amount) || 0);
        const linkedTo = row.referred_user_id ?? null;
        if (linkedTo) {
          bonusByReferredUser.set(
            linkedTo,
            round2((bonusByReferredUser.get(linkedTo) ?? 0) + amount),
          );
        }
      }

      const referralMembers = (
        (referralRows.data ?? []) as Array<{
          id: string;
          full_name: string;
          created_at: string;
        }>
      ).map((member) => ({
        ...member,
        bonus: bonusByReferredUser.get(member.id) ?? 0,
      }));

      setSummary({
        adReward: round2(sumAmounts(adRows.data)),
        referralBonus: round2(sumAmounts(referralBonuses)),
        dailyProfit: dailyProfitTotal,
        totalWithdrawn: sumAmounts(withdrawals),
        totalDeposited,
        totalPendingWithdrawals,
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

      setAdEarnings((adEarningsRows.data ?? []) as AdEarning[]);
      setReferrals(referralMembers);
      setRecentWithdrawals((recentWithdrawalRows.data ?? []) as RecentWithdrawal[]);
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

  // A verified deposit activates the plan server-side; refresh the dashboard as
  // soon as the global payment bar reports success.
  useEffect(() => {
    const onVerified = () => {
      void fetchProfile();
    };
    window.addEventListener(PAYMENT_VERIFICATION_EVENT, onVerified);
    return () => window.removeEventListener(PAYMENT_VERIFICATION_EVENT, onVerified);
  }, [fetchProfile]);

  // Platform-wide mock statistics. These are intentionally independent of the
  // signed-in user's transaction history and regenerate on each dashboard load.
  useEffect(() => {
    setPlatformStats(createPlatformStats());
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/", replace: true });
  };

  const fullName =
    profile?.full_name ??
    (typeof user?.user_metadata?.["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : "Trader");
  const email = user?.email ?? "";
  // Prefer the profile's saved referral code; fall back to the short user id.
  const referralCode = String(
    profile?.referral_code ?? (user?.id ? user.id.slice(0, 8).toUpperCase() : ""),
  );
  const referralLink = buildReferralLink(referralCode);
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

  const adsEligible = isAdsEligible(summary.activePlan?.plan_name);

  const openAd = () => {
    if (!adsEligible) {
      toast.error("Upgrade to Plan 2 or higher to unlock Ads Rewards.");
      return;
    }
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

      setProfile((current) => (current ? { ...current, extra_balance: nextExtra } : current));
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

  // The code button copies the code itself; the link button copies the full
  // https://roket.bond/signup?ref=... share URL.
  const copyReferralCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      toast.success("Referral code copied");
    } catch {
      toast.error("Couldn't copy — please copy it manually");
    }
  };

  const copyReferralLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success("Referral link copied");
    } catch {
      toast.error("Couldn't copy — please copy it manually");
    }
  };

  const totalBalance = mainBalance + extraBalance;
  // A user may only withdraw profits: total earnings (Main + Extra) minus the
  // total amount they have deposited and minus any pending withdrawal requests.
  // This drops the available balance immediately when a request is made,
  // preventing multiple pending requests that exceed the actual balance.
  const availableWithdrawal = Math.max(
    0,
    totalBalance - summary.totalDeposited - summary.totalPendingWithdrawals,
  );

  // Total Balance card shows money EARNED only — never deposits. Main is the
  // sum of daily_profit transactions; Extra is ads + referral bonuses.
  const totalDailyProfit = summary.dailyProfit;
  const totalAdsReward = summary.adReward;
  const totalReferralBonus = summary.referralBonus;
  const extraEarned = round2(totalAdsReward + totalReferralBonus);
  const totalEarned = round2(totalDailyProfit + extraEarned);

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
  const lastWithdrawAt = profile?.last_withdraw_at
    ? new Date(profile.last_withdraw_at).getTime()
    : null;
  const withdrawCooldownLeftMs =
    lastWithdrawAt != null ? lastWithdrawAt + WITHDRAW_COOLDOWN_MS - Date.now() : 0;
  const withdrawLocked = withdrawCooldownLeftMs > 0;
  const withdrawCooldownDays = withdrawLocked
    ? Math.max(1, Math.ceil(withdrawCooldownLeftMs / (24 * 60 * 60 * 1000)))
    : 0;
  const withdrawBlockedReason = withdrawLocked
    ? `You can withdraw again in ${withdrawCooldownDays} day${withdrawCooldownDays === 1 ? "" : "s"}.`
    : "";

  const openWithdrawal = () => {
    setWithdrawAmount("");
    setHoldProgress(0);
    setHoldTimer(null);
    setHoldStartTime(null);

    const wallets = profile?.saved_wallets as SavedWallets | undefined;
    const defaultType =
      ((profile?.default_wallet_type ?? "bep20") as WalletType) ?? "bep20";
    const options = walletOptions(wallets);
    const defaultOption =
      options.find((o) => o.type === defaultType) ?? options[0] ?? null;
    setSelectedWallet(defaultOption);
    setWithdrawalOpen(true);
  };

  const submitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submissionDone) return;
    if (!user || withdrawalBusy) return;
    if (withdrawLocked) {
      toast.error(withdrawBlockedReason || "Withdrawals are limited to once every 7 days.");
      return;
    }
    if (!selectedWallet?.address.trim()) {
      toast.error("Please select a wallet address.");
      return;
    }
    const amount = Math.round(Number(withdrawAmount) * 100) / 100;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter a valid withdrawal amount.");
      return;
    }
    // Min $50, max $200, and never more than the available (profit) balance.
    if (amount < 50) {
      toast.error("The minimum withdrawal amount is $50.00.");
      return;
    }
    if (amount > 200) {
      toast.error("The maximum withdrawal amount is $200.00.");
      return;
    }
    if (amount > availableWithdrawal) {
      toast.error("Amount exceeds your available balance.");
      return;
    }

    setWithdrawalBusy(true);
    setSubmissionDone(false); // allow previous call to finish without re-triggering UI flash
    try {
      const nowIso = new Date().toISOString();
      const address = selectedWallet.address.trim();
      const { error: txError } = await supabase.from("transactions").insert({
        user_id: user.id,
        type: "withdrawal",
        amount: -amount,
        status: "pending",
        wallet_address: address,
        network: selectedWallet.type.toUpperCase(),
        plan_name: `Withdraw to ${WALLET_LABELS[selectedWallet.type]}`,
        tx_hash: `wd-${Date.now()}`,
        created_at: nowIso,
      });
      if (txError) throw txError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ last_withdraw_at: nowIso })
        .eq("id", user.id);
      if (profileError) throw profileError;

      setProfile((current) =>
        current ? { ...current, last_withdraw_at: nowIso } : current,
      );
      setWithdrawalOpen(false);
      setWithdrawAmount("");
      setSelectedWallet(null);
      setHoldProgress(0);
      setHoldTimer(null);
      setHoldStartTime(null);
      setWithdrawalSuccess(true);
      setSubmissionDone(true); // block any further submissions (hold-timer + button)
      // Single success toast only — prevents infinite stacking on repeated submit calls.
      toast.success("Withdrawal request submitted for manual review.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't submit withdrawal.";
      toast.error(message);
    } finally {
      setWithdrawalBusy(false);
    }
  };

  /** True when the typed amount passes all client-side withdrawal rules. */
  const parsedWithdrawAmount = Number(withdrawAmount);
  const isWithdrawAmountValid =
    Number.isFinite(parsedWithdrawAmount) &&
    parsedWithdrawAmount >= 50 &&
    parsedWithdrawAmount <= 200 &&
    parsedWithdrawAmount <= availableWithdrawal;

  const startHold = (e: React.MouseEvent) => {
    e.preventDefault();
    if (
      withdrawalBusy ||
      holdActive ||
      withdrawLocked ||
      !selectedWallet?.address.trim() ||
      !isWithdrawAmountValid
    )
      return;
    setHoldActive(true);
    setHoldProgress(0);
    setHoldStartTime(Date.now());
    setHoldTimer(
      setInterval(() => {
        const elapsed = (Date.now() - (holdStartTime ?? 0)) / HOLD_SECONDS_MS;
        setHoldProgress(Math.min(elapsed, 1));
        if (elapsed >= 1) {
          cancelHold();
          void submitWithdrawal({
            preventDefault: () => {},
          } as unknown as React.FormEvent);
        }
      }, HOLD_TICK_MS),
    );
  };

  const cancelHold = () => {
    setHoldActive(false);
    setHoldProgress(0);
    setHoldStartTime(null);
    if (holdTimer) clearInterval(holdTimer);
    setHoldTimer(null);
  };

  // Auto-dismiss the success notification bar after 3 seconds.
  useEffect(() => {
    if (!withdrawalSuccess) return;
    const t = setTimeout(() => setWithdrawalSuccess(false), 3000);
    // Clear the timer only when the component unmounts or the dependency changes;
    // NOT on every render, so the notification actually disappears.
    return () => clearTimeout(t);
  }, [withdrawalSuccess]);

  const openWalletManagement = () => {
    const wallets = profile?.saved_wallets as SavedWallets | undefined;
    setSavedWallets({
      bep20: String(wallets?.bep20 ?? ""),
      solana: String(wallets?.solana ?? ""),
      trc20: String(wallets?.trc20 ?? ""),
    });
    setDefaultWalletType(
      ((profile?.default_wallet_type ?? "bep20") as WalletType) ?? "bep20",
    );
    setWalletManagementOpen(true);
  };

  const saveWallets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || walletBusy) return;
    setWalletBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          saved_wallets: savedWallets,
          default_wallet_type: defaultWalletType,
        })
        .eq("id", user.id);
      if (error) throw error;
      setProfile((current) =>
        current
          ? { ...current, saved_wallets: savedWallets, default_wallet_type: defaultWalletType }
          : current,
      );
      toast.success("Wallet addresses saved.");
      setWalletManagementOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save your wallets.");
    } finally {
      setWalletBusy(false);
    }
  };

  const openPassword = () => {
    setNewPassword("");
    setConfirmPassword("");
    setPasswordOpen(true);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordBusy) return;
    if (newPassword.length < 6) {
      toast.error("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match.");
      return;
    }
    setPasswordBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw new Error(error.message);
      setPasswordOpen(false);
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update your password.");
    } finally {
      setPasswordBusy(false);
    }
  };

  const openPhone = () => {
    setPhoneInput(profile?.phone_number ?? "");
    setPhoneOpen(true);
  };

  const savePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || phoneBusy) return;
    const value = phoneInput.trim();
    if (!value) {
      toast.error("Enter your phone number.");
      return;
    }
    setPhoneBusy(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ phone_number: value })
        .eq("id", user.id);
      if (error) throw new Error(error.message);
      setProfile((current) => (current ? { ...current, phone_number: value } : current));
      setPhoneOpen(false);
      toast.success("Phone number updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update your phone number.");
    } finally {
      setPhoneBusy(false);
    }
  };

  const requestCancelPlan = () => {
    toast.info("Plan cancellation is reviewed by support. Please contact support to proceed.");
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
                  {money(Number.isFinite(totalEarned) ? totalEarned : 0)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Main {money(totalDailyProfit)} · Extra {money(extraEarned)}
                </p>
                <dl className="mt-4 space-y-2 border-t border-gray-800 pt-4 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Daily Earning</dt>
                    <dd
                      className={
                        totalDailyProfit > 0
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-muted-foreground"
                      }
                    >
                      {`+${money(totalDailyProfit)}${
                        dailyEarning > 0 ? ` (${money(dailyEarning)}/day)` : ""
                      }`}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Ads Reward</dt>
                    <dd
                      className={
                        totalAdsReward > 0
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-muted-foreground"
                      }
                    >
                      {totalAdsReward > 0 ? `+${money(totalAdsReward)}` : money(0)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">Referral Bonus</dt>
                    <dd
                      className={
                        totalReferralBonus > 0
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-muted-foreground"
                      }
                    >
                      {totalReferralBonus > 0 ? `+${money(totalReferralBonus)}` : money(0)}
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

            <section className="mt-4 rounded-2xl border border-gray-800 bg-gray-900/50 p-5 backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Live Chart
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Live candlesticks · updates every 3s
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  <span
                    className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
                    aria-hidden="true"
                  />
                  Random Market
                </span>
              </div>

              <LiveMarketChart />
              <PlatformProfitLossPanel stats={platformStats} />
              <p className="mt-3 text-[11px] text-muted-foreground">
                These are Roket platform statistics.
              </p>
            </section>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <AdsRewardCard earnings={adEarnings} onWatchAds={openAd} eligible={adsEligible} />
              <ReferralCard
                code={referralCode}
                link={referralLink}
                referrals={referrals}
                onCopyCode={copyReferralCode}
                onCopyLink={copyReferralLink}
              />
              <WithdrawCard
                available={availableWithdrawal}
                withdrawals={recentWithdrawals}
                locked={withdrawLocked}
                lockedReason={withdrawBlockedReason}
                onWithdrawal={openWithdrawal}
                onSetWallet={openWalletManagement}
              />
              <UserControlCard
                email={email}
                phone={profile?.phone_number ?? null}
                planName={activePlanName}
                deposit={investmentAmount}
                dailyProfit={dailyEarning}
                totalProfit={summary.dailyProfit}
                duration={`${PLAN_TOTAL_DAYS} Days`}
                kycVerified={kycVerified}
                onChangePassword={openPassword}
                onEditPhone={openPhone}
                onCancelPlan={requestCancelPlan}
                onLogout={signOut}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <section className="rounded-2xl border border-gray-800 border-l-4 border-l-blue-500 bg-gray-900/50 p-5 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-blue-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-white">Notification</h2>
                </div>
                <div className="mt-3 h-24 overflow-y-auto rounded bg-gray-950/50 p-3">
                  <ul className="space-y-3">
                    <li className="flex items-start gap-2.5 text-xs">
                      <Bell
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400"
                        aria-hidden="true"
                      />
                      <span className="text-muted-foreground">
                        System maintenance scheduled for Oct 25, 02:00 UTC
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5 text-xs">
                      <Gift
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400"
                        aria-hidden="true"
                      />
                      <span className="text-muted-foreground">
                        Referral bonus increased to 10% for a limited time!
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5 text-xs">
                      <Bell
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-400"
                        aria-hidden="true"
                      />
                      <span className="text-muted-foreground">
                        Daily plan profits are distributed at 00:00 UTC.
                      </span>
                    </li>
                  </ul>
                </div>
              </section>

              <section className="rounded-2xl border border-gray-800 border-l-4 border-l-rose-500 bg-gray-900/50 p-5 backdrop-blur">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-rose-400" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-white">Need Help?</h2>
                </div>
                <ul className="mt-2 space-y-1">
                  <li>
                    <a
                      href="https://t.me/roket_trade"
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground transition hover:bg-gray-950/60 hover:text-blue-400"
                    >
                      <Send className="h-4 w-4 text-blue-400" aria-hidden="true" />
                      <span>Message on Telegram</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:info@roket.bond?subject=Support%20Ticket"
                      className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground transition hover:bg-gray-950/60 hover:text-emerald-400"
                    >
                      <Ticket className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                      <span>Submit A Ticket</span>
                    </a>
                  </li>
                  <li>
                    <a
                      href="mailto:info@roket.bond"
                      className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm text-muted-foreground transition hover:bg-gray-950/60 hover:text-rose-400"
                    >
                      <Mail className="h-4 w-4 text-rose-400" aria-hidden="true" />
                      <span>Email Us: info@roket.bond</span>
                    </a>
                  </li>
                </ul>
              </section>
            </div>
          </>
        )}
      </main>

      {passwordOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/70 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="password-title"
            className="my-auto w-full max-w-md rounded-2xl border bg-card p-5 shadow-glow sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                  Security
                </p>
                <h2 id="password-title" className="mt-1 font-display text-xl font-bold">
                  Change Password
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Choose a new password for your Roket account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !passwordBusy && setPasswordOpen(false)}
                disabled={passwordBusy}
                aria-label="Close change password"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitPassword} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="new-password" className="text-sm font-medium">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className="w-full rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="confirm-password" className="text-sm font-medium">
                  Confirm Password
                </label>
                <input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your new password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  className="w-full rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <button
                type="submit"
                disabled={passwordBusy || !newPassword || !confirmPassword}
                className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              >
                {passwordBusy ? "Updating…" : "Update Password"}
              </button>
            </form>
          </div>
        </div>
      )}

      {phoneOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain bg-black/70 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="phone-title"
            className="my-auto w-full max-w-md rounded-2xl border bg-card p-5 shadow-glow sm:p-6"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                  Account
                </p>
                <h2 id="phone-title" className="mt-1 font-display text-xl font-bold">
                  Edit Phone Number
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  We use this number to reach you about your account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !phoneBusy && setPhoneOpen(false)}
                disabled={phoneBusy}
                aria-label="Close edit phone number"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <form onSubmit={savePhone} className="mt-4 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="phone-number" className="text-sm font-medium">
                  Phone Number
                </label>
                <input
                  id="phone-number"
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="+1 555 010 2030"
                  autoComplete="tel"
                  className="w-full rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                />
              </div>

              <button
                type="submit"
                disabled={phoneBusy || !phoneInput.trim()}
                className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              >
                {phoneBusy ? "Saving…" : "Save Phone Number"}
              </button>
            </form>
          </div>
        </div>
      )}

      {walletManagementOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-management-title"
            className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-glow"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                  Wallet Management
                </p>
                <h2 id="wallet-management-title" className="mt-1 font-display text-xl font-bold">
                  Saved Wallets
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Save your addresses and pick the default withdrawal wallet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => !walletBusy && setWalletManagementOpen(false)}
                disabled={walletBusy}
                aria-label="Close wallet management"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <form onSubmit={saveWallets} className="mt-4 space-y-6">
              <div className="space-y-4">
                {WALLET_TYPES.map((type) => {
                  const isDefault = defaultWalletType === type;
                  const address = savedWallets[type];
                  return (
                    <div key={type} className="flex items-center gap-3 border-b border-border pb-2 last:border-0">
                      <div className="flex-1 space-y-1">
                        <label className="text-sm font-medium text-muted-foreground">
                          {WALLET_LABELS[type]} Address
                        </label>
                        <input
                          id={`wallet-${type}`}
                          value={address}
                          onChange={(e) =>
                            setSavedWallets({
                              ...savedWallets,
                              [type]: e.target.value,
                            })
                          }
                          placeholder={
                            type === "bep20"
                              ? "0x..."
                              : type === "solana"
                                ? "Solana address..."
                                : "TRC20 address..."
                          }
                          className="w-full rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                        />
                      </div>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isDefault}
                        onClick={() => setDefaultWalletType(type)}
                        className={`h-6 w-6 rounded-full border-2 shrink-0 transition-colors ${
                          isDefault
                            ? "border-brand bg-brand"
                            : "border-muted-foreground hover:border-primary"
                        }`}
                      >
                        {isDefault && (
                          <span className="flex h-3 w-3 items-center justify-center">
                            <svg
                              className="h-2.5 w-2.5 fill-primary-foreground"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l1.414 1.414a1 1 0 001.414 0l1.414-1.414a1 1 0 000-1.414z"
                                clipRule="evenodd"
                              />
                            </svg>
                          </span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                Select the default wallet by choosing its radio button. It will be
                pre-selected when you request a withdrawal.
              </p>

              <button
                type="submit"
                disabled={walletBusy}
                className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              >
                {walletBusy ? "Saving…" : "Save Wallets"}
              </button>
            </form>
          </div>
        </div>
      )}

      {withdrawalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="withdrawal-title"
            className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-glow"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                  Withdraw
                </p>
                <h2 id="withdrawal-title" className="mt-1 font-display text-xl font-bold">
                  Request Withdrawal
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Available balance: {money(availableWithdrawal)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setWithdrawalOpen(false)}
                disabled={withdrawalBusy || holdActive}
                aria-label="Close withdrawal"
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                ✕
              </button>
            </div>

            <form onSubmit={submitWithdrawal} className="mt-4 space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Withdraw to</label>
                <div className="flex items-center gap-2">
                  {selectedWallet ? (
                    <span className="text-sm text-muted-foreground">
                      {maskWallet(selectedWallet.address)} (
                      {WALLET_LABELS[selectedWallet.type]})
                    </span>
                  ) : (
                    <span className="text-sm text-amber-500">No saved wallets</span>
                  )}
                  {walletOptions(profile?.saved_wallets as SavedWallets | undefined).length > 1 && (
                    <select
                      value={selectedWallet?.type ?? ""}
                      onChange={(e) => {
                        const type = e.target.value as WalletType;
                        const addr =
                          (profile?.saved_wallets as SavedWallets | undefined)?.[
                            type
                          ] ?? "";
                        setSelectedWallet({ type, address: addr });
                      }}
                      className="rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                      disabled={withdrawalBusy || holdActive}
                    >
                      {walletOptions(
                        profile?.saved_wallets as SavedWallets | undefined,
                      ).map((o) => (
                        <option key={o.type} value={o.type}>
                          {WALLET_LABELS[o.type]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="withdrawal-amount" className="text-sm font-medium">
                  Withdrawal Amount (USD)
                </label>
                <input
                  id="withdrawal-amount"
                  type="number"
                  min="50"
                  max="200"
                  step="0.01"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border bg-muted px-4 py-3 text-sm outline-none focus:border-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Min $50.00 · Max $200.00 · Available{" "}
                  {money(availableWithdrawal)}
                </p>
              </div>

              {withdrawBlockedReason && (
                <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-500">
                  {withdrawBlockedReason}
                </p>
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  onMouseDown={startHold}
                  onMouseUp={cancelHold}
                  onMouseLeave={cancelHold}
                  onDragEnd={cancelHold}
                  disabled={
                    withdrawalBusy ||
                    !selectedWallet?.address.trim() ||
                    !isWithdrawAmountValid ||
                    withdrawLocked
                  }
                  className={`w-full rounded-lg py-3 font-display font-bold text-primary-foreground shadow-glow transition-all duration-200 ${
                    holdActive ? "bg-emerald-500" : "bg-brand"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {holdActive ? "Hold to confirm…" : "Submit Withdrawal"}
                </button>
                <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all duration-100"
                    style={{ width: `${holdProgress * 100}%` }}
                  />
                </div>
                <p className="text-center text-xs text-muted-foreground">
                  Hold for 3 seconds to confirm. Release to cancel.
                </p>
              </div>
              <p className="text-center text-xs text-muted-foreground">
                One withdrawal every 7 days. Requests need manual review.
              </p>
            </form>
          </div>
        </div>
      )}

      {withdrawalSuccess && (
        <div
          role="status"
          aria-live="polite"
          data-testid="withdrawal-success-bar"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex w-[calc(100%_-_2rem)] max-w-md items-center gap-3 rounded-2xl border border-emerald-400/30 bg-slate-950/80 px-4 py-3 shadow-2xl backdrop-blur-xl shadow-[0_0_45px_-10px_rgba(16,185,129,0.9)] ring-1 ring-emerald-400/10"
        >
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
              className="h-5 w-5"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 10.5l4 4 8-9" />
            </svg>
          </span>
          <p className="min-w-0 flex-1 font-medium leading-snug text-emerald-50">
            Withdrawal request submitted successfully! Pending admin approval.
          </p>
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
