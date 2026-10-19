import { UserPlus, Wallet, CircleDollarSign, type LucideIcon } from "lucide-react";

type Step = { icon: LucideIcon; title: string; text: string };

const steps: Step[] = [
  {
    icon: UserPlus,
    title: "Create Account",
    text: "Sign up in under a minute with just your name, email and a password. No paperwork, no waiting room.",
  },
  {
    icon: Wallet,
    title: "Choose a Plan",
    text: "Pick the plan that fits you — from $60 up to $250 — and fund your wallet. Your deposit is what starts working.",
  },
  {
    icon: CircleDollarSign,
    title: "Earn Daily Profits",
    text: "Profit lands in your balance every day of your 365-day term. Withdraw whenever you want, day or night.",
  },
];

export function HowItWorks() {
  return (
    <section className="border-y bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-4xl font-bold">How It Works</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
          Three steps stand between you and your first daily payout.
        </p>

        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} className="relative overflow-hidden rounded-2xl border bg-card p-7">
              <span className="pointer-events-none absolute right-5 top-3 font-display text-6xl font-bold text-muted">
                {i + 1}
              </span>
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand text-primary-foreground shadow-glow">
                <s.icon className="h-6 w-6" />
              </span>
              <h3 className="mt-5 text-xl font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
