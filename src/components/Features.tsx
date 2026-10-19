import { ShieldCheck, Bot, Banknote, Users, type LucideIcon } from "lucide-react";

type Feature = { icon: LucideIcon; title: string; text: string };

const features: Feature[] = [
  {
    icon: ShieldCheck,
    title: "Secure Wallet",
    text: "Two-factor sign-in, withdrawal address locking and cold-storage custody keep your funds yours.",
  },
  {
    icon: Bot,
    title: "Automated Trading",
    text: "The engine runs your plan around the clock. No charts to babysit, no manual orders to place.",
  },
  {
    icon: Banknote,
    title: "Daily Payouts",
    text: "Profit is credited to your balance every single day of your 365-day term — not at month end.",
  },
  {
    icon: Users,
    title: "MLM Referral Bonus",
    text: "Earn a bonus on every friend you invite, plus a share of their activity for as long as they trade.",
  },
];

export function Features() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h2 className="text-center text-4xl font-bold">Why Choose Us</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
        Built for people who want steady results without sitting at a screen.
      </p>

      <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-2xl border bg-card p-6 transition-colors hover:border-primary/60"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-secondary/15 text-secondary">
              <f.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
