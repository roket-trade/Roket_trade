import { useEffect, useState } from "react";
import {
  Banknote,
  CreditCard,
  PlayCircle,
  TrendingUp,
  UserPlus,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

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
    title: "Withdraw Your Profits",
    text: "Request a payout straight to your saved wallet — $50 minimum and $200 maximum per request.",
  },
];

const VIDEO_ID = "zwrojeC1iM8";
const VIDEO_SRC = `https://www.youtube.com/embed/${VIDEO_ID}?autoplay=1&rel=0`;
const VIDEO_TITLE = "How Roket works";

export function HowItWorks() {
  const [videoOpen, setVideoOpen] = useState(false);

  useEffect(() => {
    if (!videoOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setVideoOpen(false);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [videoOpen]);

  return (
    <section id="how-it-works" className="border-y bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-4xl font-bold">How It Works</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
          Five steps from sign-up to your first withdrawal.
        </p>

        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={() => setVideoOpen(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-5 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/20"
          >
            <PlayCircle className="h-5 w-5" aria-hidden="true" />
            Watch Video
          </button>
        </div>

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

      {videoOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={VIDEO_TITLE}
          onClick={() => setVideoOpen(false)}
        >
          <div className="relative w-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setVideoOpen(false)}
              aria-label="Close video"
              className="absolute -right-2 -top-12 grid h-10 w-10 cursor-pointer place-items-center rounded-full border border-white/20 bg-black/60 text-white transition-colors hover:bg-black"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="aspect-video overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl">
              <iframe
                src={VIDEO_SRC}
                title={VIDEO_TITLE}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
