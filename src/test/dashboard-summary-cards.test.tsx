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
          if (filters["type"] === "ad_earning") {
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

afterEach(cleanup);

describe("Dashboard top summary cards", () => {
  it("renders totals, plan progress and withdrawal aggregates in a 3-column glass grid", async () => {
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
