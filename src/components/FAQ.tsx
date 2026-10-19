import { useState } from "react";
import { ChevronDown } from "lucide-react";

const faqs = [
  {
    q: "What is the minimum deposit?",
    a: "The smallest plan starts at $60. From there you can move up to $120, $180 or $250 at any time — the bigger the deposit, the larger the daily profit.",
  },
  {
    q: "How do I deposit, and how long does it take?",
    a: "Deposit from your wallet on the dashboard. Funds are credited as soon as the transfer is confirmed on the network, and your plan starts earning from that moment.",
  },
  {
    q: "When can I withdraw, and how fast are payouts?",
    a: "Any time, day or night. Withdrawal requests are approved instantly during working hours and reach your wallet within minutes; network congestion is the only thing that can slow it down.",
  },
  {
    q: "Is there a fee on deposits or withdrawals?",
    a: "Roket charges no deposit fee. Withdrawals are free too — you only pay the standard network fee that the blockchain itself collects.",
  },
  {
    q: "What happens to my deposit when the 365 days are up?",
    a: "At the end of your term your deposit stays in your wallet and is fully withdrawable, alongside any profit you have not already cashed out. You can also roll it straight into a new term.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section className="mx-auto max-w-3xl px-6 py-20">
      <h2 className="text-center text-4xl font-bold">Frequently Asked Questions</h2>
      <p className="mx-auto mt-3 max-w-md text-center text-muted-foreground">
        The short answers on deposits, withdrawals and terms.
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
