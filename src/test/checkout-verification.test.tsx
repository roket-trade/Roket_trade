import type { ComponentType, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/routes/checkout";

const { routeOptions, startVerification, insertMock } = vi.hoisted(() => ({
  routeOptions: {} as { component?: ComponentType },
  startVerification: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    routeOptions.component = options.component;
    return { ...options, useSearch: () => ({ plan: 2 }) };
  },
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
  useNavigate: () => vi.fn(),
}));

vi.mock("@/components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/PaymentVerificationProvider", () => ({
  usePaymentVerification: () => ({
    state: "idle",
    txHash: null,
    startVerification,
    hide: vi.fn(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: () => ({
      insert: insertMock,
      // No stored plan → the downgrade guard lets the checkout form through.
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  },
}));

const TX_HASH = `0x${"A".repeat(64)}`;
const NORMALIZED_TX_HASH = TX_HASH.toLowerCase();

beforeEach(() => {
  insertMock.mockReset();
  insertMock.mockResolvedValue({ error: null });
  startVerification.mockReset();
});

afterEach(cleanup);

describe("checkout crypto verification handoff", () => {
  it("saves the deposit as pending, closes the form and starts global verification", async () => {
    const Checkout = routeOptions.component;
    if (!Checkout) throw new Error("checkout route component was not registered");

    render(<Checkout />);

    fireEvent.change(screen.getByLabelText("Transaction Hash (TxID)"), {
      target: { value: TX_HASH },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit Payment" }));

    // The deposit is only written after the "did you really send it?" check.
    expect(insertMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Yes, I sent it" }));

    await waitFor(() => expect(startVerification).toHaveBeenCalledTimes(1));

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0]?.[0]).toMatchObject({
      user_id: "user-1",
      type: "deposit",
      plan_name: "Plan 2",
      amount: 120,
      deposit_amount: 120,
      network: "BEP20",
      tx_hash: NORMALIZED_TX_HASH,
      status: "pending",
    });

    // The UI never waits for on-chain verification: the form is gone and the
    // global bar (triggered through context) owns the progress UX.
    expect(startVerification).toHaveBeenCalledWith({
      txHash: NORMALIZED_TX_HASH,
      userId: "user-1",
      planName: "Plan 2",
    });
    expect(screen.queryByLabelText("Transaction Hash (TxID)")).toBeNull();
    expect(screen.getByText("Payment submitted")).toBeInTheDocument();
    expect(screen.getByText(`TxID: ${TX_HASH}`)).toBeInTheDocument();
  });
});
