import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { z } from "zod";
import { RequireAuth } from "@/components/RequireAuth";
import { usePaymentVerification } from "@/components/PaymentVerificationProvider";
import { supabase } from "@/integrations/supabase/client";
import { fetchCurrentPlanIndex, isPlanUpgrade } from "@/lib/plans";

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
  validateSearch: (s: Record<string, unknown>): { plan: number } => {
    const n = Number(String(s["plan"] ?? "1").replace(/"/g, ""));
    return { plan: n >= 1 && n <= 4 ? Math.floor(n) : 1 };
  },
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
  const plan = PLANS[String(planId) as PlanId];
  const navigate = useNavigate();
  const [net, setNet] = useState<Net>("BEP20");
  const [tx, setTx] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Validated TxID waiting for the "did you really send it?" confirmation.
  const [confirmTx, setConfirmTx] = useState<string | null>(null);
  // Set when the signed-in user already owns this plan (or a better one). The
  // page redirects to the dashboard; this state keeps the checkout form closed
  // in case the redirect cannot happen.
  const [planBlocked, setPlanBlocked] = useState(false);
  const { startVerification } = usePaymentVerification();
  const address = NETWORKS[net].address;

  // Plans only move upwards: buying the same plan again or downgrading is not
  // allowed, so a deep link to a lower plan bounces back to the dashboard.
  useEffect(() => {
    let active = true;

    const checkPlan = async () => {
      const { data } = await supabase.auth.getUser();
      const current = await fetchCurrentPlanIndex(data.user?.id);
      if (!active || current === null || isPlanUpgrade(current, planId)) return;

      setPlanBlocked(true);
      toast.error(
        current === planId
          ? `You're already on ${plan.name}.`
          : `You can only upgrade to a higher plan than ${plan.name}.`,
      );
      navigate({ to: "/dashboard", replace: true });
    };

    void checkPlan();

    return () => {
      active = false;
    };
  }, [navigate, plan.name, planId]);

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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (planBlocked) {
      toast.error("This plan isn't available to you — choose a higher plan.");
      return;
    }
    const parsed = txSchema.safeParse(tx);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid transaction hash");
      return;
    }
    setError("");
    // Nothing is written until the modal below is confirmed — a TxID sent by
    // mistake creates a pending deposit that has to be cleaned up by hand.
    setConfirmTx(parsed.data);
  };

  const confirmSubmit = async () => {
    const txHashInput = confirmTx;
    if (txHashInput === null) return;
    setConfirmTx(null);
    setBusy(true);

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error("[checkout] getUser failed:", userError);
        const msg = userError.message || "Not authenticated. Please log in again.";
        setError(msg);
        toast.error(msg);
        return;
      }
      const userId = userData.user?.id;
      if (!userId) {
        const msg = "Not authenticated. Please log in again.";
        setError(msg);
        toast.error(msg);
        return;
      }

      const amount = parseFloat(String(plan.deposit));
      // EVM transaction hashes are case-insensitive; Solana signatures are not.
      // Normalise BEP20 hashes so the unique index blocks replay attempts.
      const txHash = net === "BEP20" ? txHashInput.toLowerCase() : txHashInput;
      const payload = {
        user_id: userId,
        type: "deposit",
        plan_name: plan.name,
        amount,
        deposit_amount: amount,
        network: net,
        wallet_address: address,
        tx_hash: txHash,
        status: "pending",
      };
      if (!Number.isFinite(payload.amount) || !Number.isFinite(payload.deposit_amount)) {
        const msg = "Invalid plan amount. Please reselect your plan.";
        setError(msg);
        toast.error(msg);
        return;
      }
      let { error: dbError } = await supabase
        .from("transactions")
        .insert(payload, { defaultToNull: false });
      if (dbError?.code === "PGRST205") {
        const fallback = await supabase.from("payments").insert(payload, { defaultToNull: false });
        dbError = fallback.error;
      }
      if (dbError) {
        console.error("[checkout] insert failed:", {
          code: dbError.code,
          message: dbError.message,
          details: dbError.details,
          hint: dbError.hint,
        });
        const msg =
          dbError.code === "23505"
            ? "This transaction hash was already submitted."
            : dbError.message || `Insert failed (${dbError.code ?? "unknown"}).`;
        setError(msg);
        toast.error(msg);
        return;
      }
      // Close the payment form immediately. Verification happens in the
      // background (pg_cron -> verify-crypto-deposit); the global bar reports
      // the Realtime status change — we never block the UI on it.
      setDone(true);
      startVerification({ txHash, userId, planName: plan.name });
      toast.success("Payment submitted — verifying on-chain");
    } catch (err) {
      console.error("[checkout] submit failed:", err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Something went wrong. Please try again.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RequireAuth>
      <div className="min-h-screen px-4 py-10">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <Link to="/">
            <img src="/logo.png" alt="Roket" className="mx-auto h-10" />
          </Link>

          <section className="rounded-2xl border bg-card p-6">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">Selected plan</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
              <h1 className="font-display text-3xl font-bold">{plan.name}</h1>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Deposit amount</p>
                <p className="font-display text-2xl font-bold text-primary">
                  {money(plan.deposit)}
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {money(plan.daily)} daily · 365 days
            </p>
          </section>

          {planBlocked ? (
            <section className="rounded-2xl border border-amber-500/40 bg-card p-8 text-center">
              <h2 className="font-display text-2xl font-bold">Plan not available</h2>
              <p className="mt-3 text-sm text-muted-foreground">
                {plan.name} isn&apos;t available on your account — you can only upgrade to a higher
                plan.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Link
                  to="/dashboard"
                  className="inline-block rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground"
                >
                  Go to dashboard
                </Link>
                <Link
                  to="/"
                  hash="pricing"
                  className="inline-block rounded-lg border border-primary px-6 py-3 font-display font-bold text-primary hover:bg-primary/10"
                >
                  See plans
                </Link>
              </div>
            </section>
          ) : done ? (
            <section className="rounded-2xl border border-primary bg-card p-8 text-center shadow-glow">
              <h2 className="font-display text-2xl font-bold">Payment submitted</h2>
              <p className="mt-3">
                We&apos;re verifying your transaction on the blockchain. Your plan activates
                automatically once it confirms — you can close this page.
              </p>
              <p className="mt-4 break-all rounded-lg border bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
                TxID: {tx}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                <Link
                  to="/dashboard"
                  className="inline-block rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground"
                >
                  Go to dashboard
                </Link>
                <Link
                  to="/"
                  className="inline-block rounded-lg border border-primary px-6 py-3 font-display font-bold text-primary hover:bg-primary/10"
                >
                  Back to home
                </Link>
              </div>
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
                <span className="font-semibold text-foreground">{money(plan.deposit)}</span> in USDT
                via {NETWORKS[net].label} to:
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {net === "BEP20" ? "USDT (BEP20) on BNB Smart Chain" : "USDT (SPL) on Solana"} only
                — other tokens can&apos;t be verified automatically.
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

          {/* Confirmation gate: the deposit row is only created once the user
              confirms they actually sent the exact amount to this address. */}
          {confirmTx !== null && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
              onClick={() => setConfirmTx(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="checkout-confirm-title"
                className="w-full max-w-sm rounded-2xl border bg-card p-6 shadow-glow"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 id="checkout-confirm-title" className="font-display text-lg font-bold">
                  Are you sure you have sent the exact amount to this address?
                </h2>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-bold text-brand">{money(plan.deposit)} USDT</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-muted-foreground">Network</dt>
                    <dd className="font-semibold">{NETWORKS[net].label}</dd>
                  </div>
                </dl>
                <p className="mt-3 break-all rounded-lg border bg-muted px-3 py-2 font-mono text-xs">
                  {address}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Deposits are reviewed before your plan activates. A wrong amount or network cannot
                  be verified automatically.
                </p>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmTx(null)}
                    className="rounded-lg border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
                  >
                    Go back
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmSubmit()}
                    className="rounded-lg bg-brand px-4 py-2 text-sm font-bold text-primary-foreground shadow-glow disabled:opacity-60"
                  >
                    Yes, I sent it
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </RequireAuth>
  );
}
