import type { ComponentType, ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/routes/checkout";
import { planIndex } from "@/lib/plans";

const { routeOptions, navigateMock, toastError, state } = vi.hoisted(() => ({
  routeOptions: {} as { component?: ComponentType },
  navigateMock: vi.fn(),
  toastError: vi.fn(),
  state: { plan: "Plan 3" as string | null },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    routeOptions.component = options.component;
    return { ...options, useSearch: () => ({ plan: 2 }) };
  },
  useNavigate: () => navigateMock,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("@/components/RequireAuth", () => ({
  RequireAuth: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/PaymentVerificationProvider", () => ({
  usePaymentVerification: () => ({ state: "idle", txHash: null, startVerification: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: toastError } }));

vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  Object.assign(query, {
    select: chain,
    eq: chain,
    maybeSingle: () => Promise.resolve({ data: { plan_name: state.plan }, error: null }),
  });
  return {
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: "user-1" } }, error: null }) },
      from: () => query,
    },
  };
});

beforeEach(() => {
  state.plan = "Plan 3";
  navigateMock.mockReset();
  toastError.mockReset();
});

afterEach(cleanup);

describe("checkout plan guard", () => {
  it("redirects to the dashboard when the user already owns the plan", async () => {
    state.plan = "Plan 2";
    const Checkout = routeOptions.component;
    if (!Checkout) throw new Error("checkout route component was not registered");

    render(<Checkout />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard", replace: true }),
    );
    expect(screen.getByText("Plan not available")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("You're already on Plan 2.");
  });

  it("redirects when the requested plan is a downgrade", async () => {
    state.plan = "Plan 4";
    const Checkout = routeOptions.component;
    if (!Checkout) throw new Error("checkout route component was not registered");

    render(<Checkout />);

    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith({ to: "/dashboard", replace: true }),
    );
    expect(toastError).toHaveBeenCalledWith("You can only upgrade to a higher plan than Plan 2.");
  });

  it("keeps the checkout form open for a real upgrade", async () => {
    state.plan = "Plan 1";
    const Checkout = routeOptions.component;
    if (!Checkout) throw new Error("checkout route component was not registered");

    render(<Checkout />);

    await waitFor(() => expect(screen.getByText(/Payment method/)).toBeInTheDocument());
    expect(navigateMock).not.toHaveBeenCalled();
    expect(planIndex(state.plan)).toBe(1);
  });
});
