import { useEffect, useRef, useState } from "react";

type Action = "Deposit" | "Withdrawal";

type Tx = {
  id: number;
  name: string;
  action: Action;
  amount: number;
  time: string;
};

const MAX_ROWS = 5;

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

function makeTx(when = new Date()): Tx {
  const action = pick(actions);
  return {
    id: ++seq,
    name: pick(names),
    action,
    amount: pick(amounts[action]),
    time: clock(when),
  };
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

  if (action === "Withdrawal") {
    return (
      <svg {...common}>
        <path d="M10 17V6" />
        <path d="M5.5 10L10 5.5 14.5 10" />
      </svg>
    );
  }

  return null;
}

export function LiveTransactions() {
  const [rows, setRows] = useState<Tx[]>([]);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const now = Date.now();
    setRows(
      Array.from({ length: 3 }, (_, i) => makeTx(new Date(now - (i + 1) * 9000))),
    );

    const schedule = () => {
      timer.current = window.setTimeout(
        () => {
          setRows((prev) => [makeTx(), ...prev].slice(0, MAX_ROWS));
          schedule();
        },
        5000 + Math.random() * 10000,
      );
    };

    schedule();

    return () => window.clearTimeout(timer.current);
  }, []);

  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold">Live Transactions</h2>
          <p className="mt-2 text-muted-foreground">
            Latest activity across Roket accounts.
          </p>
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
              key={r.id}
              className="tx-in flex items-center gap-4 rounded-xl border bg-card px-4 py-3"
            >
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${s.chip}`}
              >
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
