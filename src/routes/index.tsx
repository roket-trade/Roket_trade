import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/roket-logo.png.asset.json";
import { CandleChart } from "@/components/CandleChart";

const plans = [
  { name: "Plan 1", deposit: 60, daily: 1 },
  { name: "Plan 2", deposit: 120, daily: 3 },
  { name: "Plan 3", deposit: 180, daily: 4.5 },
  { name: "Plan 4", deposit: 250, daily: 8 },
];

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

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-4xl font-bold">Choose your plan</h2>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {plans.map((p, i) => (
            <div key={p.name} className={`flex flex-col rounded-2xl border bg-card p-6 ${i === 3 ? "border-primary shadow-glow" : ""}`}>
              <h3 className="text-xl font-bold">{p.name}</h3>
              <p className="mt-4 text-4xl font-bold text-brand">${p.deposit}</p>
              <p className="text-sm text-muted-foreground">deposit</p>
              <p className="mt-4 text-lg"><span className="font-bold text-primary">${p.daily}</span> daily</p>
              <Link to="/signup" className={`${cta} mt-6`}>Get Started</Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
