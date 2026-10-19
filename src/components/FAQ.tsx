import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

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
  return (
    <section className="mx-auto max-w-3xl px-6 py-20">
      <h2 className="text-center text-4xl font-bold">Frequently Asked Questions</h2>
      <p className="mx-auto mt-3 max-w-md text-center text-muted-foreground">
        The short answers on deposits, withdrawals and terms.
      </p>

      <Accordion type="single" collapsible className="mt-10">
        {faqs.map((f, i) => (
          <AccordionItem
            key={f.q}
            value={`item-${i}`}
            className="mb-3 rounded-xl border bg-card px-5"
          >
            <AccordionTrigger className="text-base font-semibold hover:no-underline">
              {f.q}
            </AccordionTrigger>
            <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
              {f.a}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
