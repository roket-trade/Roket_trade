import { Banknote, CreditCard, TrendingUp, UserPlus, Wallet, type LucideIcon } from "lucide-react";

type Step = { icon: LucideIcon; title: string; text: string };

const steps: Step[] = [
  {
    icon: UserPlus,
    title: "Create Account & Complete KYC",
    text: "Sign up in minutes, then verify your identity so your account and payouts stay secure.",
  },
  {
    icon: Wallet,
    title: "Deposit USDT",
    text: "Fund your account with USDT on BEP20 or Solana. Every deposit is verified on-chain automatically.",
  },
  {
    icon: CreditCard,
    title: "Choose a Plan",
    text: "Pick Plan 1 through Plan 4 — $60 to $250 — and your daily profit starts as soon as the plan is active.",
  },
  {
    icon: TrendingUp,
    title: "Earn Daily Profits & Refer",
    text: "Profit lands in your balance every day for 365 days. Share your link to earn 10% of each referral deposit.",
  },
  {
    icon: Banknote,
    title: "Withdraw (Every 7 days)",
    text: "Request a payout every 7 days — $50 minimum and $200 maximum per request, sent to your saved wallet.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-4xl font-bold">How It Works</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
          Five steps from sign-up to your first withdrawal.
        </p>

        <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
          {steps.map((s, i) => (
            <li
              key={s.title}
              className="relative flex flex-col overflow-hidden rounded-2xl border bg-card p-6"
            >
              <span className="pointer-events-none absolute right-4 top-2 font-display text-5xl font-bold text-muted">
                {i + 1}
              </span>
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand text-primary-foreground shadow-glow">
                <s.icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-base font-bold leading-snug">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
