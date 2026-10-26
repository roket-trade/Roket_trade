import { BadgeCheck, Gift, Headset, PlayCircle, ShieldCheck, type LucideIcon } from "lucide-react";

type Feature = { icon: LucideIcon; title: string; text: string };

const features: Feature[] = [
  {
    icon: BadgeCheck,
    title: "Auto Crypto Verification",
    text: "Supports USDT BEP20 & Solana deposits, matched on-chain and credited to your balance automatically.",
  },
  {
    icon: Gift,
    title: "10% Referral Bonus",
    text: "Share your referral link and earn 10% of every deposit your referrals make, credited instantly.",
  },
  {
    icon: PlayCircle,
    title: "Watch Ads & Earn",
    text: "Watch short ads for extra rewards on top of your daily profit. Exclusive to Plan 2 and above.",
  },
  {
    icon: ShieldCheck,
    title: "Secure Withdrawals",
    text: "Withdrawals are reviewed before payout, with a $50 minimum and $200 maximum per request.",
  },
  {
    icon: Headset,
    title: "24/7 Live Chat Support",
    text: "Talk to a real person any time, day or night — or open a ticket straight from your dashboard.",
  },
];

export function Features() {
  return (
    <section id="features" className="mx-auto max-w-5xl px-6 py-20">
      <h2 className="text-center text-4xl font-bold">Why Choose Us</h2>
      <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
        Real tools, clear rules and payouts you can plan around.
      </p>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <div
            key={f.title}
            className="h-full rounded-2xl border bg-card p-6 transition-colors hover:border-primary/60"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-secondary/15 text-secondary">
              <f.icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
