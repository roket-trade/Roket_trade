import type { ComponentType, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/routes/dashboard";

const { mockUser, mockProfile, startDate } = vi.hoisted(() => ({
  mockUser: {
    id: "11111111-2222-3333-4444-555555555555",
    email: "trader@example.com",
    created_at: "2024-01-01T00:00:00.000Z",
    user_metadata: { full_name: "Test Trader" },
  },
  mockProfile: {
    id: "11111111-2222-3333-4444-555555555555",
    full_name: "Test Trader",
    created_at: "2024-01-01T00:00:00.000Z",
    extra_balance: 20,
    main_balance: 250,
    kyc_status: "verified",
    referral_code: "TEST1234",
    referred_by: null,
    id_card_url: null,
    is_admin: false,
    address: null,
    last_withdraw_at: null,
    phone_number: null,
    default_wallet_address: "0x35aec7E35F65ea227e49fDd321709D52Ada389E4",
    plan_started_at: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString(),
    plan_expires_at: new Date(Date.now() + 321 * 24 * 60 * 60 * 1000).toISOString(),
  },
  startDate: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString(),
}));

const { routeOptions } = vi.hoisted(() => ({
  routeOptions: {} as { component?: ComponentType },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    routeOptions.component = options.component;
    return options;
  },
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: "/dashboard", searchStr: "" } }),
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

vi.mock("@/components/KycModal", () => ({ KycModal: () => null }));
vi.mock("@/components/HilltopVideoAd", () => ({ HilltopVideoAd: () => null }));

vi.mock("react-apexcharts", () => ({
  default: ({ type }: { type?: string }) => <div data-testid="apex-chart" data-chart-type={type} />,
}));

// Returns fixture rows per transaction type so the dashboard's aggregate
// queries (ads, referral bonuses, withdrawals, active plan) can be asserted.
vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const filters: Record<string, string> = {};
    const query: Record<string, unknown> = {};
    const chain = () => query;
    Object.assign(query, {
      select: chain,
      eq: (column: string, value: string) => {
        filters[column] = value;
        return query;
      },
      in: (column: string, values: string[]) => {
        filters[column] = values.join(",");
        return query;
      },
      order: chain,
      limit: chain,
      insert: chain,
      update: chain,
      single: () =>
        Promise.resolve({ data: table === "profiles" ? mockProfile : null, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: table === "profiles" ? mockProfile : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        let data: unknown[] = [];
        if (table === "transactions") {
          if (filters["type"]?.includes("daily_profit")) {
            const nowIso = new Date().toISOString();
            data = [
              { type: "daily_profit", amount: 3, created_at: nowIso },
              { type: "ad_earning", amount: 1, created_at: nowIso },
              { type: "referral_bonus", amount: 2.5, created_at: nowIso },
            ];
          } else if (filters["type"] === "ad_earning") {
            data = [
              { id: "ad-1", amount: 0.1, created_at: "2026-09-01T00:00:00.000Z" },
              { id: "ad-2", amount: 0.05, created_at: "2026-09-02T00:00:00.000Z" },
            ];
          } else if (filters["type"] === "referral_bonus") {
            data = [{ id: "rb-1", amount: 12, created_at: "2026-09-03T00:00:00.000Z" }];
          } else if (filters["type"] === "withdrawal") {
            data = [
              {
                id: "wd-1",
                amount: -50,
                created_at: "2026-09-04T00:00:00.000Z",
                wallet_address: "0x35aec7E35F65ea227e49fDd321709D52Ada389E4",
              },
            ];
          } else if (filters["type"] === "deposit") {
            data = [
              {
                plan_name: "Plan 3",
                deposit_amount: 180,
                amount: 180,
                created_at: startDate,
              },
            ];
          }
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    });
    return query;
  };

  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: mockUser }, error: null }),
        signOut: () => Promise.resolve({ error: null }),
      },
      from: (table: string) => builder(table),
    },
  };
});

const DashboardPage = () => {
  const Component = routeOptions.component;
  if (!Component) throw new Error("dashboard route component was not captured");
  return <Component />;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard top summary cards", () => {
  it("renders totals, plan progress and withdrawal aggregates in a 3-column glass grid", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { container } = render(<DashboardPage />);

    expect(await screen.findByText("Total Balance")).toBeInTheDocument();

    // Card 1 — total balance + aggregate small rows.
    expect(screen.getByText("$270.00")).toBeInTheDocument();
    expect(screen.getByText("+$4.50 / day")).toBeInTheDocument();
    expect(screen.getByText("+$0.15")).toBeInTheDocument();
    expect(screen.getByText("+$12.00")).toBeInTheDocument();

    // Card 2 — active plan from the latest completed deposit.
    expect(screen.getByText("Plan 3")).toBeInTheDocument();
    expect(screen.getByText("$180.00")).toBeInTheDocument();
    expect(screen.getByText("Day 45 / 365")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "Plan progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "45");
    expect(progress.firstElementChild?.className).toContain("bg-gradient-to-r");

    // Card 3 — completed withdrawals + truncated default wallet.
    expect(screen.getByText("Total withdrawn")).toBeInTheDocument();
    expect(screen.getAllByText("$50.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0x35...89E4")).toBeInTheDocument();

    // Live candlestick chart + platform-wide profit/loss stats.
    expect(screen.getByText("Live Chart")).toBeInTheDocument();
    expect(screen.getByText("Random Market")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Live Roket market candlestick chart" }),
    ).toBeInTheDocument();
    const chart = await screen.findByTestId("apex-chart");
    expect(chart).toHaveAttribute("data-chart-type", "candlestick");

    expect(screen.getByText("Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("Platform Loss")).toBeInTheDocument();
    expect(screen.getByText("Today Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("This Week Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("This Month Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("Today Platform Loss")).toBeInTheDocument();
    expect(screen.getByText("This Week Platform Loss")).toBeInTheDocument();
    expect(screen.getByText("This Month Platform Loss")).toBeInTheDocument();

    // Math.random is pinned to 0.5: today = 30k (loss 30k/9), week = 180k,
    // month = 835k.
    expect(await screen.findByText("+$30,000.00")).toBeInTheDocument();
    expect(screen.getByText("+$180,000.00")).toBeInTheDocument();
    expect(screen.getByText("+$835,000.00")).toBeInTheDocument();
    expect(screen.getByText("-$3,333.33")).toBeInTheDocument();
    expect(screen.getByText("-$20,000.00")).toBeInTheDocument();
    expect(screen.getByText("-$92,777.78")).toBeInTheDocument();
    expect(screen.getByText("These are Roket platform statistics.")).toBeInTheDocument();

    // Dark glassmorphism styling + responsive 3-column grid.
    const grid = container.querySelector(".mt-8.grid");
    expect(grid?.className).toContain("md:grid-cols-3");
    expect(grid?.children).toHaveLength(3);
    for (const card of Array.from(grid?.children ?? [])) {
      expect(card.className).toContain("bg-gray-900/50");
      expect(card.className).toContain("border-gray-800");
      expect(card.className).toContain("backdrop-blur");
    }
  });
});
