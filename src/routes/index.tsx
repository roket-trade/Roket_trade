import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/roket-logo.png.asset.json";
import { CandleChart } from "@/components/CandleChart";
import { LiveTransactions } from "@/components/LiveTransactions";
import { HowItWorks } from "@/components/HowItWorks";
import { Features } from "@/components/Features";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";

type Plan = { name: string; deposit: number; daily: number; popular?: boolean };

const plans: Plan[] = [
  { name: "Plan 1", deposit: 60, daily: 1 },
  { name: "Plan 2", deposit: 120, daily: 3 },
  { name: "Plan 3", deposit: 180, daily: 4.5, popular: true },
  { name: "Plan 4", deposit: 250, daily: 8 },
];

const features = ["Instant Payouts", "24/7 Support", "Auto-Trading"];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Roket — Crypto Trading Plans" },
      { name: "description", content: "Trade crypto with Roket. Choose a plan from $60 and get started today." },
      { property: "og:title", content: "Roket — Crypto Trading Plans" },
      { property: "og:description", content: "Trade crypto with Roket. Choose a plan from $60 and get started today." },
    ],
  }),
  component: Index,
});

const cta = "inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-105";

const money = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

function Check() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4 shrink-0 text-primary">
      <path
        d="M4 10.5l4 4 8-9"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Index() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <img src={logo.url} alt="Roket" className="h-10" />
        <Link to="/signup" className={cta}>Get Started</Link>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-2">
        <div>
          <h1 className="text-5xl font-bold leading-tight md:text-6xl">
            Launch your trading <span className="text-brand">to the moon</span>
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Simple plans, daily earnings, and a dashboard built for speed.
          </p>
          <Link to="/signup" className={`${cta} mt-8`}>Get Started</Link>
        </div>
        <div className="chart-glow h-[420px] overflow-hidden rounded-2xl border bg-card p-3">
          <CandleChart />
        </div>
      </section>

      <LiveTransactions />

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-4xl font-bold">Choose your plan</h2>
        <p className="mt-3 text-center text-muted-foreground">
          Every plan runs for 365 days and includes the full feature set.
        </p>
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:items-stretch">
          {plans.map((p, i) => (
            <div
              key={p.name}
              className={`relative flex flex-col rounded-2xl border bg-card p-6 ${
                p.popular ? "border-primary shadow-glow ring-1 ring-primary/40 lg:-mt-3" : ""
              }`}
            >
              {p.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
                  Most Popular
                </span>
              )}

              <h3 className="text-xl font-bold">{p.name}</h3>

              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Deposit</dt>
                  <dd className="font-bold text-brand">{money(p.deposit)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Daily Profit</dt>
                  <dd className="font-bold text-primary">{money(p.daily)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Total Profit</dt>
                  <dd className="font-bold">{money(p.daily * 365)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-muted-foreground">Duration</dt>
                  <dd className="font-bold">365 Days</dd>
                </div>
              </dl>

              <ul className="mt-5 space-y-2 border-t pt-5 text-sm">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <Link to="/checkout" search={{ plan: i + 1 }} className={`${cta} mt-6 w-full`}>Choose Plan</Link>
            </div>
          ))}
        </div>
      </section>

      <HowItWorks />

      <Features />

      <FAQ />

      <Footer />
    </div>
  );
}
