import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  plan: "Plan 2" as string | null,
  user: { id: "user-1" } as { id: string } | null,
  loading: false,
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: state.user, session: null, loading: state.loading }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));

vi.mock("@/components/CandleChart", () => ({ CandleChart: () => <div data-testid="chart" /> }));
vi.mock("@/components/LiveTransactions", () => ({ LiveTransactions: () => null }));

vi.mock("@/integrations/supabase/client", () => {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  Object.assign(query, {
    select: chain,
    eq: chain,
    maybeSingle: () => Promise.resolve({ data: { plan_name: state.plan }, error: null }),
  });
  return { supabase: { from: () => query } };
});

import { Route } from "@/routes/index";
import { blockedPlanLabel, isPlanUpgrade, planIndex } from "@/lib/plans";

const Index = (Route as unknown as { component: () => ReactNode }).component;

function planCard(name: string) {
  const heading = screen.getByRole("heading", { name });
  return heading.parentElement as HTMLElement;
}

beforeEach(() => {
  state.plan = "Plan 2";
  state.user = { id: "user-1" };
  state.loading = false;
});

afterEach(cleanup);

describe("plan ranking", () => {
  it("ranks stored plan names and ignores unknown ones", () => {
    expect(planIndex("Plan 1")).toBe(1);
    expect(planIndex("Plan 4")).toBe(4);
    expect(planIndex(" plan 3 ")).toBe(3);
    expect(planIndex(null)).toBeNull();
    expect(planIndex("")).toBeNull();
    expect(planIndex("Watch Ads")).toBeNull();
    expect(planIndex("Plan 9")).toBeNull();
  });

  it("only treats strictly higher plans as upgrades", () => {
    expect(isPlanUpgrade(null, 1)).toBe(true);
    expect(isPlanUpgrade(2, 3)).toBe(true);
    expect(isPlanUpgrade(2, 2)).toBe(false);
    expect(isPlanUpgrade(3, 2)).toBe(false);
    expect(blockedPlanLabel(2, 2)).toBe("Current Plan");
    expect(blockedPlanLabel(3, 2)).toBe("Upgrade Required");
  });
});

describe("landing pricing respects the current plan", () => {
  it("blocks the current plan and every lower plan", async () => {
    render(<Index />);

    await waitFor(() =>
      expect(within(planCard("Plan 2")).getByText("Current Plan")).toBeInTheDocument(),
    );

    const current = within(planCard("Plan 2")).getByRole("button", { name: "Current Plan" });
    expect(current).toBeDisabled();

    const lower = within(planCard("Plan 1")).getByRole("button", {
      name: "Upgrade Required",
    });
    expect(lower).toBeDisabled();
    expect(within(planCard("Plan 1")).queryByRole("link")).toBeNull();
    expect(within(planCard("Plan 2")).queryByRole("link")).toBeNull();
  });

  it("never flashes Choose Plan while the owned plan is still loading", async () => {
    render(<Index />);

    // First paint, before the plan read resolves: a skeleton, not an enabled
    // "Choose Plan" that turns into "Current Plan" a beat later.
    expect(within(planCard("Plan 2")).queryByRole("link")).toBeNull();
    expect(within(planCard("Plan 2")).getByTestId("plan-loading-2")).toBeInTheDocument();
    expect(within(planCard("Plan 2")).queryByRole("button")).toBeNull();

    await waitFor(() =>
      expect(within(planCard("Plan 2")).getByText("Current Plan")).toBeInTheDocument(),
    );
    expect(within(planCard("Plan 2")).queryByTestId("plan-loading-2")).toBeNull();
  });

  it("keeps the skeleton when the session resolves after mount", async () => {
    // AuthProvider starts anonymous-and-loading, then resolves the session. Both
    // values land in one commit, so a loading flag seeded at mount would already
    // have settled — this is the transition that flashed "Choose Plan".
    state.user = null;
    state.loading = true;
    const { rerender } = render(<Index />);
    expect(within(planCard("Plan 2")).getByTestId("plan-loading-2")).toBeInTheDocument();

    state.user = { id: "user-1" };
    state.loading = false;
    rerender(<Index />);

    // That paint must still be a skeleton: the rank has not been read yet.
    expect(within(planCard("Plan 2")).queryByRole("link")).toBeNull();
    expect(within(planCard("Plan 2")).getByTestId("plan-loading-2")).toBeInTheDocument();

    await waitFor(() =>
      expect(within(planCard("Plan 2")).getByText("Current Plan")).toBeInTheDocument(),
    );
  });

  it("keeps higher plans purchasable", async () => {
    render(<Index />);

    await waitFor(() =>
      expect(within(planCard("Plan 2")).getByText("Current Plan")).toBeInTheDocument(),
    );

    expect(within(planCard("Plan 3")).getByRole("link", { name: "Choose Plan" })).toHaveAttribute(
      "href",
      "/checkout",
    );
    expect(within(planCard("Plan 4")).getByRole("link", { name: "Choose Plan" })).toHaveAttribute(
      "href",
      "/checkout",
    );
  });
});
