import type { ComponentType, ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/routes/dashboard";

const { mockUser, mockProfile, startDate } = vi.hoisted(() => ({
  mockUser: {
    id: "11111111-2222-3333-4444-555555555555",
    email: "trader@example.com",
    created_at: "2024-01-01T00:00:00.000Z",
    user_metadata: { full_name: "Test Trader" },
  },
  // The reported account: Main $39.00 + Extra $88.35 = $127.35.
  mockProfile: {
    id: "11111111-2222-3333-4444-555555555555",
    full_name: "Test Trader",
    created_at: "2024-01-01T00:00:00.000Z",
    main_balance: 39,
    extra_balance: 88.35,
    kyc_status: "verified",
    referral_code: "TEST1234",
    referred_by: null,
    id_card_url: null,
    is_admin: false,
    address: null,
    last_withdraw_at: null,
    phone_number: null,
    default_wallet_address: null,
    plan_name: "Plan 3",
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

// Every transaction fixture carries its own status so the assertions below prove
// that only completed rows feed the Lifetime totals.
const TX_ROWS = [
  { type: "daily_profit", amount: 150, status: "completed", created_at: startDate },
  { type: "daily_profit", amount: 999, status: "pending", created_at: startDate },
  { type: "ad_earning", amount: 7.5, status: "completed", created_at: startDate },
  { type: "ad_earning", amount: 500, status: "failed", created_at: startDate },
  { type: "referral_bonus", amount: 20, status: "completed", created_at: startDate },
  { type: "welcome_bonus", amount: 2.5, status: "completed", created_at: startDate },
  {
    type: "withdrawal",
    amount: -10,
    status: "completed",
    created_at: startDate,
    wallet_address: null,
  },
  {
    type: "withdrawal",
    amount: -40,
    status: "pending",
    created_at: startDate,
    wallet_address: null,
  },
  {
    type: "deposit",
    amount: 180,
    deposit_amount: 180,
    plan_name: "Plan 3",
    status: "completed",
    created_at: startDate,
  },
];

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const filters: Record<string, string> = {};
    const query: Record<string, unknown> = {};
    const chain = () => query;
    Object.assign(query, {
      select: chain,
      eq: (column: string, value: string) => {
        filters[column] = String(value);
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
        if (table === "profiles" && filters["referred_by"]) {
          data = [{ id: "ref-1", full_name: "Alice Referral", created_at: startDate }];
        }
        if (table === "transactions") {
          const wantedTypes = filters["type"] ? filters["type"].split(",") : null;
          data = TX_ROWS.filter(
            (row) =>
              (!wantedTypes || wantedTypes.includes(row.type)) &&
              (!filters["status"] || filters["status"] === row.status),
          );
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
  if (!Component) throw new Error("dashboard route component was captured");
  return <Component />;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard Total Balance card", () => {
  it("adds main_balance + extra_balance and lists lifetime totals below", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<DashboardPage />);

    expect(await screen.findByText("Total Balance")).toBeInTheDocument();
    const card = screen.getByText("Total Balance").closest("section") as HTMLElement;

    // Headline is exactly main_balance + extra_balance (39 + 88.35).
    expect(within(card).getByText("$127.35")).toBeInTheDocument();
    // The breakdown adds up to the headline.
    expect(within(card).getByText("Main $39.00 · Extra $88.35")).toBeInTheDocument();

    // The three rows are lifetime totals of completed transactions — never the
    // remaining balance, and never the pending/failed rows.
    expect(within(card).getByText("Lifetime")).toBeInTheDocument();
    expect(within(card).getByText(/^\+\$150\.00/)).toBeInTheDocument();
    expect(within(card).getByText("+$7.50")).toBeInTheDocument();
    // Referral Bonus is referral_bonus (20) only — never the welcome bonus.
    expect(within(card).getByText("+$20.00")).toBeInTheDocument();
    // The $2.50 KYC bonus gets its own row instead of hiding under "Referral Bonus".
    expect(within(card).getByText("Welcome Bonus")).toBeInTheDocument();
    expect(within(card).getByText("+$2.50")).toBeInTheDocument();
    expect(within(card).queryByText("+$22.50")).toBeNull();

    expect(within(card).queryByText(/999/)).toBeNull();
    expect(within(card).queryByText(/500/)).toBeNull();
  });
});
