import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient as useReactQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { PaymentVerificationBar } from "@/components/PaymentVerificationBar";
import { supabase } from "@/integrations/supabase/client";
import {
  PAYMENT_VERIFICATION_EVENT,
  type PaymentVerificationState,
  type PaymentVerificationTarget,
} from "@/lib/payment-verification";

/** How long the success pill stays on screen before hiding itself. */
export const SUCCESS_VISIBLE_MS = 3000;
/** Light fallback poll; Realtime is the primary signal. */
export const VERIFICATION_POLL_MS = 10_000;
/** Give up on a stuck spinner after 10 minutes and ask the user to contact support. */
export const VERIFICATION_TIMEOUT_MS = 10 * 60_000;

type PaymentVerificationContextValue = {
  state: PaymentVerificationState;
  txHash: string | null;
  startVerification: (target: PaymentVerificationTarget) => void;
  hide: () => void;
};

const noop = () => {};

const PaymentVerificationContext = createContext<PaymentVerificationContextValue>({
  state: "idle",
  txHash: null,
  startVerification: noop,
  hide: noop,
});

export function PaymentVerificationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PaymentVerificationState>("idle");
  const [target, setTarget] = useState<PaymentVerificationTarget | null>(null);
  const stateRef = useRef<PaymentVerificationState>("idle");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queryClient = useReactQueryClient();
  const router = useRouter();

  const updateState = useCallback((next: PaymentVerificationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const hide = useCallback(() => {
    clearHideTimer();
    setTarget(null);
    updateState("idle");
  }, [clearHideTimer, updateState]);

  const refreshUserData = useCallback(() => {
    // Plan data is fetched by the dashboard/checkout queries; invalidate both
    // React Query caches and the router so the newly active plan appears.
    void queryClient.invalidateQueries();
    void router.invalidate();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(PAYMENT_VERIFICATION_EVENT));
    }
  }, [queryClient, router]);

  const applyStatus = useCallback(
    (status: string | null | undefined) => {
      if (status === "completed") {
        if (stateRef.current === "success") return;
        clearHideTimer();
        updateState("success");
        refreshUserData();
        hideTimer.current = setTimeout(() => {
          setTarget(null);
          updateState("idle");
        }, SUCCESS_VISIBLE_MS);
        return;
      }

      if (status === "rejected" && stateRef.current === "verifying") {
        updateState("failed");
      }
    },
    [clearHideTimer, refreshUserData, updateState],
  );

  const startVerification = useCallback(
    (next: PaymentVerificationTarget) => {
      if (!next.txHash) return;
      clearHideTimer();
      setTarget(next);
      updateState("verifying");
    },
    [clearHideTimer, updateState],
  );

  const txHash = target?.txHash ?? null;

  // Realtime subscription + light polling while a payment is in flight.
  // Everything is torn down when the bar hides, the payment resolves, or the
  // provider unmounts.
  useEffect(() => {
    if (!txHash || state !== "verifying") return;

    let cancelled = false;

    const channel = supabase
      .channel(`payment-verification:${txHash}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "transactions",
          filter: `tx_hash=eq.${txHash}`,
        },
        (payload) => {
          if (cancelled) return;
          const nextStatus = (payload.new as { status?: string } | null)?.status;
          applyStatus(nextStatus);
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") {
          console.warn("[payment-verification] Realtime channel error; falling back to polling.");
        }
      });

    const checkStatus = async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("status")
        .eq("tx_hash", txHash)
        .eq("type", "deposit")
        .limit(1)
        .maybeSingle();
      if (cancelled || error || !data) return;
      applyStatus((data as { status?: string }).status);
    };

    // A fast chain can confirm before the Realtime channel is joined, so check
    // once immediately and then poll as a safety net.
    void checkStatus();

    const poll = window.setInterval(() => {
      void checkStatus();
    }, VERIFICATION_POLL_MS);

    const timeout = window.setTimeout(() => {
      if (!cancelled && stateRef.current === "verifying") updateState("failed");
    }, VERIFICATION_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, [applyStatus, state, txHash, updateState]);

  // Never leave a success/failed timer behind on unmount.
  useEffect(() => clearHideTimer, [clearHideTimer]);

  const value = useMemo<PaymentVerificationContextValue>(
    () => ({ state, txHash, startVerification, hide }),
    [hide, startVerification, state, txHash],
  );

  return (
    <PaymentVerificationContext.Provider value={value}>
      {children}
      <PaymentVerificationBar state={state} onDismiss={hide} />
    </PaymentVerificationContext.Provider>
  );
}

export function usePaymentVerification() {
  return useContext(PaymentVerificationContext);
}
