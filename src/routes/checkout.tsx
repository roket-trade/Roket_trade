import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { z } from "zod";
import logo from "@/assets/roket-logo.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

const PLANS = {
  "1": { name: "Plan 1", deposit: 60, daily: 1 },
  "2": { name: "Plan 2", deposit: 120, daily: 3 },
  "3": { name: "Plan 3", deposit: 180, daily: 4.5 },
  "4": { name: "Plan 4", deposit: 250, daily: 8 },
} as const;
type PlanId = keyof typeof PLANS;

const NETWORKS = {
  BEP20: {
    label: "BNB Smart Chain (BEP20)",
    address: "0x35aec7E35F65ea227e49fDd321709D52Ada389E4",
  },
  SOL: { label: "Solana", address: "3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ" },
} as const;
type Net = keyof typeof NETWORKS;

export const Route = createFileRoute("/checkout")({
  validateSearch: (s: Record<string, unknown>): { plan: PlanId } => ({
    plan: (String(s.plan ?? "1") in PLANS ? String(s.plan ?? "1") : "1") as PlanId,
  }),
  head: () => ({
    meta: [
      { title: "Checkout — Roket" },
      {
        name: "description",
        content: "Complete your Roket plan deposit with BNB Smart Chain or Solana.",
      },
      { property: "og:title", content: "Checkout — Roket" },
      {
        property: "og:description",
        content: "Complete your Roket plan deposit with BNB Smart Chain or Solana.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Checkout,
});

const txSchema = z
  .string()
  .trim()
  .min(20, "Transaction hash looks too short")
  .max(120, "Transaction hash is too long")
  .regex(/^[A-Za-z0-9]+$/, "Only letters and numbers allowed");
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

function Checkout() {
  const { plan: planId } = Route.useSearch();
  const plan = PLANS[planId];
  const [net, setNet] = useState<Net>("BEP20");
  const [tx, setTx] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const address = NETWORKS[net].address;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied to clipboard");
    } catch {
      const field = document.createElement("textarea");
      field.value = address;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(field);
      if (copied) toast.success("Address copied to clipboard");
      else toast.error("Couldn't copy — please copy it manually");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = txSchema.safeParse(tx);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    setError("");
    setBusy(true);
    const payload = {
      plan_name: plan.name,
      deposit_amount: plan.deposit,
      network: net,
      wallet_address: address,
      tx_hash: parsed.data,
      status: "pending",
    };
    let { error: dbError } = await supabase.from("transactions").insert(payload);
    if (dbError?.code === "PGRST205") {
      const fallback = await supabase.from("payments").insert(payload);
      dbError = fallback.error;
    }
    setBusy(false);
    if (dbError) {
      const msg =
        dbError.code === "23505"
          ? "This transaction hash was already submitted."
          : "Something went wrong. Please try again.";
      setError(msg);
      toast.error(msg);
      return;
    }
    setDone(true);
    toast.success("Payment submitted");
  };

  return (
    <div className="min-h-screen px-4 py-10">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Link to="/">
          <img src={logo.url} alt="Roket" className="mx-auto h-10" />
        </Link>

        <section className="rounded-2xl border bg-card p-6">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Selected plan</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
            <h1 className="font-display text-3xl font-bold">{plan.name}</h1>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Deposit amount</p>
              <p className="font-display text-2xl font-bold text-primary">{money(plan.deposit)}</p>
            </div>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{money(plan.daily)} daily · 365 days</p>
        </section>

        {done ? (
          <section className="rounded-2xl border border-primary bg-card p-8 text-center shadow-glow">
            <h2 className="font-display text-2xl font-bold">Payment submitted successfully</h2>
            <p className="mt-3">
              Your transaction is pending manual verification. Your plan will be activated once the
              payment is confirmed.
            </p>
            <Link
              to="/"
              className="mt-6 inline-block rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground"
            >
              Back to home
            </Link>
          </section>
        ) : (
          <section className="rounded-2xl border bg-card p-6 shadow-glow">
            <h2 className="font-display text-xl font-bold">Payment method</h2>
            <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-muted p-1" role="tablist">
              {(Object.keys(NETWORKS) as Net[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={net === k}
                  onClick={() => setNet(k)}
                  className={`rounded-lg px-3 py-2 text-sm font-semibold transition ${net === k ? "bg-brand text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {NETWORKS[k].label}
                </button>
              ))}
            </div>

            <p className="mt-5 text-sm text-muted-foreground">
              Send exactly{" "}
              <span className="font-semibold text-foreground">{money(plan.deposit)}</span> via{" "}
              {NETWORKS[net].label} to:
            </p>
            <div className="mt-4 flex justify-center">
              <div className="rounded-xl bg-foreground p-3">
                <QRCodeSVG value={address} size={168} />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <code className="flex-1 break-all rounded-lg border bg-muted px-3 py-3 text-sm">
                {address}
              </code>
              <button
                type="button"
                onClick={copy}
                className="rounded-lg border border-primary px-4 py-3 text-sm font-semibold text-primary hover:bg-primary/10"
              >
                Copy Address
              </button>
            </div>

            <form onSubmit={submit} className="mt-6 space-y-3">
              <label htmlFor="tx" className="text-sm font-medium">
                Transaction Hash (TxID)
              </label>
              <input
                id="tx"
                value={tx}
                onChange={(e) => setTx(e.target.value)}
                maxLength={120}
                placeholder="Paste your transaction hash"
                className="w-full rounded-lg border bg-muted px-4 py-3 outline-none focus:border-primary"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <button
                disabled={busy}
                className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Submitting…" : "Submit Payment"}
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
