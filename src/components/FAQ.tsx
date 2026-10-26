import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "What cryptocurrency do you accept?",
    a: "We accept USDT on BEP20 and Solana networks only. Deposits sent on any other network cannot be credited to your account.",
  },
  {
    q: "How often can I withdraw?",
    a: "Every 7 days, with a minimum of $50 and maximum of $200 per request.",
  },
  {
    q: "How does the referral work?",
    a: "Earn 10% of your referred user's deposit instantly. Share your referral link from your dashboard — the bonus lands in your balance as soon as their deposit is confirmed.",
  },
  {
    q: "What is the minimum deposit?",
    a: "Plan 1 starts at $60. Plans then step up to $120, $180 and $250, and every plan runs for 365 days.",
  },
  {
    q: "Which plans unlock Ads Rewards?",
    a: "Plan 2, Plan 3 and Plan 4 unlock Watch Ads & Earn. Plan 1 does not include ads rewards.",
  },
  {
    q: "What happens when my 365 days are up?",
    a: "Your deposit stays in your balance and remains withdrawable, together with any profit you have not already cashed out. You can start a new plan at any time.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
      <h2 className="text-center text-4xl font-bold">Frequently Asked Questions</h2>
      <p className="mx-auto mt-3 max-w-md text-center text-muted-foreground">
        The short answers on deposits, withdrawals, referrals and terms.
      </p>

      <div className="mt-10">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className="mb-3 rounded-xl border bg-card px-5">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full cursor-pointer items-center justify-between gap-4 py-4 text-left text-base font-semibold"
              >
                <span>{f.q}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                className={`grid transition-all duration-300 ease-out ${
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <p className="pb-4 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
