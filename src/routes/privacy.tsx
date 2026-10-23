import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Footer } from "@/components/Footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Roket" },
      {
        name: "description",
        content: "What Roket collects, why we collect it, and how you stay in control.",
      },
      { property: "og:title", content: "Privacy Policy — Roket" },
      {
        property: "og:description",
        content: "What Roket collects, why we collect it, and how you stay in control.",
      },
    ],
  }),
  component: Privacy,
});

const sections = [
  {
    h: "1. What we collect",
    p: "Your name, email address, wallet addresses you save, and the record of your deposits, withdrawals and plan history. We also keep basic technical data such as login times and device type.",
  },
  {
    h: "2. How we use it",
    p: "To run your account, pay out profits, detect fraud and answer support requests. We do not sell your personal information to anyone.",
  },
  {
    h: "3. Cookies",
    p: "We use essential cookies to keep you signed in, and a small number of analytics cookies to understand which pages are used. You can clear these from your browser at any time.",
  },
  {
    h: "4. Data retention",
    p: "Trading records are kept while your account is open and for as long as financial rules require. If you close your account, we delete everything we are not legally obliged to keep.",
  },
  {
    h: "5. Your rights",
    p: "You can ask us for a copy of your data, ask for corrections, or ask us to delete your account. Reach out through live chat and we will act on the request.",
  },
  {
    h: "6. Security",
    p: "Access to personal data is limited to staff who need it, protected by two-factor authentication, and every payout is checked against your saved withdrawal address.",
  },
];

function Privacy() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-6 sm:px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to site
        </Link>
        <Link
          to="/signup"
          className="rounded-lg bg-brand px-5 py-2 font-display text-sm font-bold text-primary-foreground"
        >
          Get Started
        </Link>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <h1 className="text-3xl font-bold sm:text-4xl">Privacy Policy</h1>
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
