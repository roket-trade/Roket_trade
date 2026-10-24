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
/** Aggressive fallback poll; Realtime is the primary signal. */
export const VERIFICATION_POLL_MS = 5_000;
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

  // Realtime subscription + aggressive polling fallback while a payment is in
  // flight. Both are torn down when the bar hides, the payment resolves, or the
  // provider unmounts.
  useEffect(() => {
    if (!txHash || state !== "verifying") return;

    let cancelled = false;
    let poll: number | null = null;

    const stopPolling = () => {
      if (poll !== null) {
        window.clearInterval(poll);
        poll = null;
      }
    };

    // The Realtime filter must stay unquoted: tx_hash=eq.<hash>.
    console.log("[Realtime] Subscribing with filter", `tx_hash=eq.${txHash}`);

    const handleStatus = (status: string | null | undefined) => {
      if (cancelled) return;
      if (status !== "completed" && status !== "rejected") return;
      cancelled = true;
      stopPolling();
      applyStatus(status);
    };

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
          handleStatus((payload.new as { status?: string } | null)?.status);
        },
      )
      .subscribe((status) => {
        console.log("[Realtime] Subscription status:", status);
        if (status === "CHANNEL_ERROR") {
          console.warn(
            "[payment-verification] Realtime channel error; polling fallback is active.",
          );
        }
      });

    const checkStatus = async () => {
      if (cancelled) return;
      const { data, error } = await supabase
        .from("transactions")
        .select("status")
        .eq("tx_hash", txHash)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[Polling] Status query failed for", txHash, error);
        return;
      }
      if (!data) return;
      handleStatus((data as { status?: string }).status);
    };

    // Aggressive fallback: a Realtime message can be missed while the socket is
    // still joining, so also check the row every 5 seconds until terminal.
    poll = window.setInterval(() => {
      console.log("[Polling] Checking status for", txHash);
      void checkStatus();
    }, VERIFICATION_POLL_MS);

    // A fast chain can confirm before the channel is joined.
    void checkStatus();

    const timeout = window.setTimeout(() => {
      if (!cancelled && stateRef.current === "verifying") {
        cancelled = true;
        stopPolling();
        updateState("failed");
      }
    }, VERIFICATION_TIMEOUT_MS);

    return () => {
      cancelled = true;
      stopPolling();
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
