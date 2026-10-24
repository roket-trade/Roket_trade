import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PaymentVerificationProvider,
  usePaymentVerification,
} from "@/components/PaymentVerificationProvider";
import { PAYMENT_VERIFICATION_EVENT } from "@/lib/payment-verification";

const { realtime, invalidateMock } = vi.hoisted(() => ({
  invalidateMock: vi.fn(),
  realtime: {
    handler: null as ((payload: { new?: { status?: string } | null }) => void) | null,
    filter: "",
    channelName: "",
    removed: 0,
    dbStatus: "pending" as string | null,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: invalidateMock }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const maybeSingle = () =>
    Promise.resolve({
      data: realtime.dbStatus ? { status: realtime.dbStatus } : null,
      error: null,
    });

  const channel = {
    on: (
      _event: string,
      config: { filter?: string },
      handler: (payload: { new?: { status?: string } | null }) => void,
    ) => {
      realtime.filter = config.filter ?? "";
      realtime.handler = handler;
      return channel;
    },
    subscribe: (callback?: (status: string) => void) => {
      callback?.("SUBSCRIBED");
      return channel;
    },
  };

  const select = () => ({
    eq: () => ({
      eq: () => ({
        limit: () => ({ maybeSingle }),
      }),
    }),
  });

  return {
    supabase: {
      channel: (name: string) => {
        realtime.channelName = name;
        return channel;
      },
      removeChannel: () => {
        realtime.removed += 1;
        return Promise.resolve("ok");
      },
      from: () => ({ select }),
    },
  };
});

function Consumer() {
  const { state, txHash, startVerification, hide } = usePaymentVerification();
  return (
    <div>
      <span data-testid="state">{state}</span>
      <span data-testid="tx">{txHash ?? ""}</span>
      <button type="button" onClick={() => startVerification({ txHash: "0xdeadbeef" })}>
        start
      </button>
      <button type="button" onClick={hide}>
        hide
      </button>
    </div>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PaymentVerificationProvider>
        <Consumer />
      </PaymentVerificationProvider>
    </QueryClientProvider>,
  );
}

const start = () => fireEvent.click(screen.getByRole("button", { name: "start" }));

beforeEach(() => {
  realtime.handler = null;
  realtime.filter = "";
  realtime.channelName = "";
  realtime.removed = 0;
  realtime.dbStatus = "pending";
  invalidateMock.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaymentVerificationProvider", () => {
  it("subscribes to the tx_hash, flips to success, refreshes data and auto-hides", () => {
    vi.useFakeTimers();
    const onVerified = vi.fn();
    window.addEventListener(PAYMENT_VERIFICATION_EVENT, onVerified);
    renderProvider();

    start();

    expect(screen.getByTestId("state").textContent).toBe("verifying");
    expect(screen.getByTestId("tx").textContent).toBe("0xdeadbeef");
    expect(screen.getByText("Verifying payment on blockchain...")).toBeInTheDocument();
    expect(realtime.channelName).toBe("payment-verification:0xdeadbeef");
    expect(realtime.filter).toBe("tx_hash=eq.0xdeadbeef");

    act(() => {
      realtime.handler?.({ new: { status: "completed" } });
    });

    expect(screen.getByTestId("state").textContent).toBe("success");
    expect(screen.getByText("Payment Verified! Your plan is now active.")).toBeInTheDocument();
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(invalidateMock).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByTestId("state").textContent).toBe("idle");
    expect(screen.queryByTestId("payment-verification-bar")).toBeNull();
    expect(realtime.removed).toBeGreaterThan(0);

    window.removeEventListener(PAYMENT_VERIFICATION_EVENT, onVerified);
  });

  it("shows a persistent failure on rejection and cleans up when dismissed", () => {
    renderProvider();

    start();
    act(() => {
      realtime.handler?.({ new: { status: "rejected" } });
    });

    expect(screen.getByTestId("state").textContent).toBe("failed");
    expect(screen.getByText("Verification failed. Please contact support.")).toBeInTheDocument();
    expect(realtime.removed).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss payment status" }));

    expect(screen.getByTestId("state").textContent).toBe("idle");
    expect(screen.queryByTestId("payment-verification-bar")).toBeNull();
  });

  it("falls back to polling when Realtime does not deliver the update", async () => {
    vi.useFakeTimers();
    renderProvider();

    start();
    realtime.dbStatus = "completed";

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByTestId("state").textContent).toBe("success");
    expect(screen.getByText("Payment Verified! Your plan is now active.")).toBeInTheDocument();
  });

  it("unsubscribes when the bar is hidden", () => {
    renderProvider();
    start();
    expect(realtime.removed).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "hide" }));

    expect(screen.getByTestId("state").textContent).toBe("idle");
    expect(realtime.removed).toBe(1);
  });
});
