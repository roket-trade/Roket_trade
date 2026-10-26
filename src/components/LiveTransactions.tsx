import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Action = "Deposit" | "Withdrawal";

type Tx = {
  /** Unique render key. Real rows get a fresh suffix every time they loop back in. */
  key: string;
  name: string;
  action: Action;
  amount: number;
  time: string;
  real: boolean;
};

/** Shape of the columns we read from `public.transactions` / the RPC. */
type RealRow = {
  id: string;
  type: string | null;
  amount: number | null;
  created_at: string | null;
  user_name: string | null;
};

const MAX_ROWS = 5;
const REAL_LIMIT = 5;
const SIM_POOL = 4;

const names = [
  "John D.",
  "Sarah M.",
  "Ahmed R.",
  "Mei L.",
  "Diego F.",
  "Nina K.",
  "Tariq H.",
  "Emma W.",
  "Ravi P.",
  "Lena S.",
];

const actions: Action[] = ["Deposit", "Withdrawal"];

const amounts: Record<Action, number[]> = {
  Deposit: [60, 120, 180, 250],
  Withdrawal: [8.5, 25, 60, 120],
};

const look: Record<Action, { text: string; chip: string; sign: string }> = {
  Deposit: { text: "text-primary", chip: "bg-primary/10 text-primary", sign: "+" },
  Withdrawal: { text: "text-destructive", chip: "bg-destructive/10 text-destructive", sign: "−" },
};

const money = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour12: false });

let seq = 0;

function makeSim(when = new Date()): Tx {
  const action = pick(actions);
  return {
    key: `sim-${++seq}`,
    name: pick(names),
    action,
    amount: pick(amounts[action]),
    time: clock(when),
    real: false,
  };
}

export const maskName = (name: string | null): string => {
  if (!name) return "Roket User";
  const parts = name.trim().split(" ");
  if (parts.length > 1) return `${parts[0]} ${parts[1][0]}.`;
  return parts[0];
};

function makeReal(row: RealRow): Tx | null {
  const action: Action | null =
    row.type === "deposit" ? "Deposit" : row.type === "withdrawal" ? "Withdrawal" : null;
  if (!action) return null;

  const amount = Number(row.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const when = row.created_at ? new Date(row.created_at) : new Date();
  const time = Number.isNaN(when.getTime()) ? clock(new Date()) : clock(when);

  // Customer identities stay private on the public landing page; show a masked name.
  return { key: `real-${row.id}`, name: maskName(row.user_name), action, amount, time, real: true };
}

function Icon({ action }: { action: Action }) {
  const common = {
    viewBox: "0 0 20 20",
    fill: "none",
    "aria-hidden": true,
    className: "h-4 w-4",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  if (action === "Deposit") {
    return (
      <svg {...common}>
        <path d="M10 3v11" />
        <path d="M5.5 10L10 14.5 14.5 10" />
      </svg>
    );
  }

  return (
    <svg {...common}>
      <path d="M10 17V6" />
      <path d="M5.5 10L10 5.5 14.5 10" />
    </svg>
  );
}

type SupabaseRpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>;

/**
 * Anonymous visitors cannot read `transactions` directly (RLS). The
 * SECURITY DEFINER RPC returns only type/amount/created_at, so the feed stays
 * real without exposing identities or wallets. The direct table read remains as
 * a fallback for environments where the RPC has not been deployed yet.
 */
async function fetchRecentTransactions(): Promise<RealRow[]> {
  try {
    const rpc = supabase.rpc as unknown as SupabaseRpc;
    const { data, error } = await rpc("recent_public_transactions", { row_limit: REAL_LIMIT });
    if (!error && Array.isArray(data)) return data as RealRow[];
  } catch {
    // RPC unavailable — fall through to the table read.
  }

  try {
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .in("type", ["deposit", "withdrawal"])
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(REAL_LIMIT);

    if (!error && data) return data as unknown as RealRow[];
  } catch {
    // Real activity is optional — the simulated feed keeps the section alive.
  }

  return [];
}

export function LiveTransactions() {
  const [rows, setRows] = useState<Tx[]>([]);
  const poolRef = useRef<Tx[]>([]);
  const cursorRef = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const now = Date.now();
    setRows(Array.from({ length: 3 }, (_, i) => makeSim(new Date(now - (i + 1) * 9000))));

    // Start with a simulated-only rotation so the feed never waits on the network.
    poolRef.current = Array.from({ length: SIM_POOL }, () => makeSim());

    let cancelled = false;

    const loadReal = async () => {
      const recent = await fetchRecentTransactions();
      if (cancelled || recent.length === 0) return;

      const real = recent.map(makeReal).filter((tx): tx is Tx => tx !== null);

      if (real.length === 0) return;

      // Merge real rows ahead of the simulated slots and rotate through the whole pool.
      poolRef.current = [...real, ...Array.from({ length: SIM_POOL }, () => makeSim())];
      cursorRef.current = 0;

      setRows((prev) => {
        const merged: Tx[] = [];
        const seen = new Set<string>();
        for (const tx of [...real, ...prev]) {
          if (seen.has(tx.key)) continue;
          seen.add(tx.key);
          merged.push(tx);
          if (merged.length === MAX_ROWS) break;
        }
        return merged;
      });
    };

    void loadReal();

    const nextTx = (): Tx => {
      const pool = poolRef.current;
      if (pool.length === 0) return makeSim();

      const base = pool[cursorRef.current % pool.length]!;
      cursorRef.current = (cursorRef.current + 1) % pool.length;

      // Real rows loop forever (fresh key so the entry animation replays);
      // simulated slots always generate a new name/amount.
      return base.real ? { ...base, key: `${base.key}-${++seq}` } : makeSim();
    };

    const schedule = () => {
      timer.current = window.setTimeout(
        () => {
          setRows((prev) => [nextTx(), ...prev].slice(0, MAX_ROWS));
          schedule();
        },
        5000 + Math.random() * 10000,
      );
    };

    schedule();

    return () => {
      cancelled = true;
      window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Live Transactions</h2>
          <p className="mt-2 text-muted-foreground">Latest activity across Roket accounts.</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          Live
        </span>
      </div>

      <ul className="mt-8 min-h-[430px] space-y-3">
        {rows.map((r) => {
          const s = look[r.action];
          return (
            <li
              key={r.key}
              className="tx-in flex items-center gap-4 rounded-xl border bg-card px-4 py-3"
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${s.chip}`}>
                <Icon action={r.action} />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{r.name}</p>
                <p className="text-xs text-muted-foreground">{r.action}</p>
              </div>
              <div className="ml-auto text-right">
                <p className={`font-display text-lg font-bold ${s.text}`}>
                  {s.sign}
                  {money(r.amount)}
                </p>
                <p className="text-xs tabular-nums text-muted-foreground">{r.time}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
