import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Roket" },
      { name: "description", content: "The terms that apply when you use Roket trading plans." },
      { property: "og:title", content: "Terms of Service — Roket" },
      { property: "og:description", content: "The terms that apply when you use Roket trading plans." },
    ],
  }),
  component: Terms,
});

const sections = [
  {
    h: "1. Using the service",
    p: "By creating a Roket account you confirm you are at least 18 years old and legally allowed to trade where you live. You are responsible for keeping your login details safe and for every action taken from your account.",
  },
  {
    h: "2. Plans and deposits",
    p: "Plans run for 365 days from the moment your deposit is confirmed. Deposits are held for the length of the term you choose, and daily profit is calculated on the plan you are enrolled in at the time.",
  },
  {
    h: "3. Withdrawals",
    p: "You may request a withdrawal at any time. Requests are reviewed before funds leave, and we can pause a payout if we detect activity that puts the account or our users at risk.",
  },
  {
    h: "4. Referral bonuses",
    p: "Referral bonuses are paid on invited accounts that complete a deposit. We can adjust or withdraw a bonus if an account is created to abuse the referral system.",
  },
  {
    h: "5. Acceptable use",
    p: "No multiple accounts from one person, no automated abuse of the sign-up process, and no use of the platform for laundering or any other unlawful purpose. Accounts that break this rule are closed and balances reviewed.",
  },
  {
    h: "6. Changes to these terms",
    p: "We may update these terms as the platform grows. If a change affects your current plan in a material way, we will tell you before it takes effect.",
  },
];

function Terms() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-6 py-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-4 w-4" />
          Back to site
        </Link>
        <Link to="/signup" className="rounded-lg bg-brand px-5 py-2 font-display text-sm font-bold text-primary-foreground">
          Get Started
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-20">
        <h1 className="text-4xl font-bold">Terms of Service</h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated: 19 October 2026</p>

        {sections.map((s) => (
          <section key={s.h} className="mt-9">
            <h2 className="text-xl font-bold">{s.h}</h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{s.p}</p>
          </section>
        ))}
      </main>

      <Footer />
    </div>
  );
}
