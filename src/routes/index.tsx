import { createFileRoute, Link } from "@tanstack/react-router";
import { CandleChart } from "@/components/CandleChart";
import { LiveTransactions } from "@/components/LiveTransactions";
import { HowItWorks } from "@/components/HowItWorks";
import { Features } from "@/components/Features";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { HeaderAuthNav } from "@/components/HeaderAuthNav";
import { useAuth } from "@/components/AuthProvider";

type Plan = {
  name: string;
  deposit: number;
  daily: number;
  /** Plan 2 and above unlock the Watch Ads & Earn rewards. */
  adsRewards?: boolean;
  popular?: boolean;
};

const plans: Plan[] = [
  { name: "Plan 1", deposit: 60, daily: 1 },
  { name: "Plan 2", deposit: 120, daily: 3, adsRewards: true },
  { name: "Plan 3", deposit: 180, daily: 4.5, adsRewards: true, popular: true },
  { name: "Plan 4", deposit: 250, daily: 8, adsRewards: true },
];

const planFeatures = [
  "Daily profit for 365 days",
  "10% referral bonus",
  "Secure withdrawals every 7 days",
];

const navLinks = [
  { href: "#how-it-works", label: "How It Works" },
  { href: "#pricing", label: "Pricing" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Roket — Automated Crypto Trading Platform" },
      {
        name: "description",
        content:
          "Automated crypto trading plans from $60. Deposit USDT on BEP20 or Solana, earn daily profit for 365 days and withdraw every 7 days.",
      },
      { property: "og:title", content: "Roket — Automated Crypto Trading Platform" },
      {
        property: "og:description",
        content:
          "Automated crypto trading plans from $60. Deposit USDT on BEP20 or Solana, earn daily profit for 365 days and withdraw every 7 days.",
      },
    ],
  }),
  component: Index,
});

const cta =
  "inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-105";

const money = (n: number) =>
  `$${n.toLocaleString("en-US", {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;

function Check() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-primary"
    >
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
  const { user } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link to="/" aria-label="Roket home">
          <img src="/logo.png" alt="Roket" className="h-10" />
        </Link>
        <nav aria-label="Sections" className="hidden items-center gap-6 md:flex">
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </a>
          ))}
        </nav>
        <HeaderAuthNav current="home" />
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-2">
        <div>
          <h1 className="text-5xl font-bold leading-tight md:text-6xl">
            Automated <span className="text-brand">Crypto Trading</span> Platform
          </h1>
          <p className="mt-5 text-lg text-muted-foreground">
            Verified USDT deposits, four fixed daily-profit plans and payouts every 7 days — fully
            automated from your first deposit.
          </p>
          <Link
            to={user ? "/dashboard" : "/signup"}
            className={`${cta} mt-8`}
            data-testid="hero-cta"
          >
            Get Started
          </Link>
          <p className="mt-4 text-sm text-muted-foreground">
            Plans from $60 · 365-day term · USDT BEP20 &amp; Solana
          </p>
        </div>
        <div className="chart-glow h-[420px] overflow-hidden rounded-2xl border bg-card p-3">
          <CandleChart />
        </div>
      </section>

      <LiveTransactions />

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-4xl font-bold">Choose your plan</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
          All plans run for 365 days. Daily profit is credited to your balance every day of your
          term.
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

              {p.adsRewards && (
                <span className="mt-3 inline-flex w-fit items-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                  Unlock Ads Rewards
                </span>
              )}

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
                {(p.adsRewards ? [...planFeatures, "Watch Ads & Earn unlocked"] : planFeatures).map(
                  (f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check />
                      <span>{f}</span>
                    </li>
                  ),
                )}
              </ul>

              <Link to="/checkout" search={{ plan: i + 1 }} className={`${cta} mt-6 w-full`}>
                Choose Plan
              </Link>
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
