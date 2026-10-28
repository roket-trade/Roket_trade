import type { ComponentType, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/routes/dashboard";

const { mockUser, mockProfile, state } = vi.hoisted(() => {
  const user = {
    id: "11111111-2222-3333-4444-555555555555",
    email: "trader@example.com",
    created_at: "2024-01-01T00:00:00.000Z",
    user_metadata: { full_name: "Test Trader" },
  };
  const profile = {
    id: "11111111-2222-3333-4444-555555555555",
    full_name: "Test Trader",
    created_at: "2024-01-01T00:00:00.000Z",
    // 270 in the wallet, 180 of it deposited → 90 withdrawable profit.
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
    plan_name: "Plan 3",
    plan_started_at: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString(),
    plan_expires_at: new Date(Date.now() + 321 * 24 * 60 * 60 * 1000).toISOString(),
  };
  return {
    mockUser: user,
    mockProfile: profile,
    // Rows the dashboard wrote during the test, so a later fetch sees them.
    state: { inserted: [] as Array<Record<string, unknown>>, pendingError: false },
  };
});

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
  default: () => <div data-testid="apex-chart" />,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const filters: Record<string, string> = {};
    let mode: "select" | "insert" | "update" = "select";
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
      insert: (payload: Record<string, unknown>) => {
        mode = "insert";
        state.inserted.push(payload);
        return query;
      },
      update: () => {
        mode = "update";
        return query;
      },
      single: () =>
        Promise.resolve({ data: table === "profiles" ? mockProfile : null, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: table === "profiles" ? mockProfile : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (mode === "insert" || mode === "update") {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        }

        let data: unknown[] = [];
        if (table === "transactions") {
          if (filters["type"] === "deposit") {
            data = [
              {
                plan_name: "Plan 3",
                deposit_amount: 180,
                amount: 180,
                created_at: mockProfile.plan_started_at,
              },
            ];
          } else if (filters["type"] === "withdrawal" && filters["status"] === "pending") {
            if (state.pendingError) {
              // Models an RLS/permission failure on the filtered read.
              return Promise.resolve({
                data: null,
                error: {
                  code: "42501",
                  message: "permission denied for table transactions",
                },
              }).then(resolve);
            }
            // The dashboard's own pending-withdrawal query: whatever is stored.
            data = state.inserted
              .filter((row) => row["type"] === "withdrawal" && row["status"] === "pending")
              .map((row) => ({ amount: row["amount"] }));
          } else if (filters["type"] === "withdrawal" && !filters["status"]) {
            // Recent withdrawals across every status — the dashboard's fallback
            // source when the filtered pending read is blocked.
            data = state.inserted
              .filter((row) => row["type"] === "withdrawal")
              .map((row, index) => ({
                id: `wd-${index}`,
                amount: row["amount"],
                created_at: row["created_at"] ?? "2026-02-05T00:00:00.000Z",
                status: row["status"],
              }));
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

/** The Withdraw card, which renders the authoritative available balance. */
async function withdrawCard() {
  const heading = await screen.findByRole("heading", { name: "Withdraw" });
  const section = heading.closest("section");
  if (!section) throw new Error("Withdraw card not found");
  return within(section);
}

async function submitWithdrawal(amount: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Withdraw" }));
  fireEvent.change(await screen.findByPlaceholderText("0.00"), { target: { value: amount } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Withdrawal" }));
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
}

afterEach(() => {
  cleanup();
  state.inserted.length = 0;
  state.pendingError = false;
  vi.restoreAllMocks();
});

describe("Dashboard withdrawal submission", () => {
  it("drops the available balance as soon as the request is confirmed", async () => {
    render(<DashboardPage />);

    const card = await withdrawCard();
    expect(await card.findByText("$90.00")).toBeInTheDocument();

    await submitWithdrawal("50");

    // The balance must move without a page reload: 90 - 50 = 40.
    await waitFor(async () => {
      const next = await withdrawCard();
      expect(next.getByText("$40.00")).toBeInTheDocument();
    });
    expect(state.inserted).toHaveLength(1);
  });

  it("stores the request as a negative pending transaction for that user", async () => {
    render(<DashboardPage />);
    await withdrawCard();

    await submitWithdrawal("75");

    await waitFor(() => expect(state.inserted).toHaveLength(1));
    expect(state.inserted[0]).toMatchObject({
      user_id: mockUser.id,
      type: "withdrawal",
      amount: -75,
      status: "pending",
      network: "BEP20",
    });
  });

  it("shows the success bar once the request is stored", async () => {
    render(<DashboardPage />);
    await withdrawCard();

    await submitWithdrawal("50");

    expect(await screen.findByTestId("withdrawal-success-bar")).toBeInTheDocument();
  });
});

/**
 * A pending request is money the user already committed: every page load has to
 * keep it out of Available Balance. These cases model a reload, where the
 * dashboard has no in-memory state to lean on and must trust the database read.
 */
describe("Dashboard pending withdrawals on load", () => {
  const pendingRow = (amount: number) => ({
    type: "withdrawal",
    amount,
    status: "pending",
    created_at: "2026-02-05T09:00:00.000Z",
  });

  it("keeps the reduced balance when a pending request is already stored", async () => {
    state.inserted.push(pendingRow(-50));

    render(<DashboardPage />);

    const card = await withdrawCard();
    // 270 in the wallet - 180 deposited - 50 pending = 40.
    expect(await card.findByText("$40.00")).toBeInTheDocument();
  });

  it("subtracts the absolute value even when the pending row has no sign", async () => {
    state.inserted.push(pendingRow(50));

    render(<DashboardPage />);

    const card = await withdrawCard();
    expect(await card.findByText("$40.00")).toBeInTheDocument();
  });

  it("falls back to the recent-withdrawals read when the pending query is denied", async () => {
    state.inserted.push(pendingRow(-50));
    state.pendingError = true;

    render(<DashboardPage />);

    const card = await withdrawCard();
    // The filtered read failed, but the same row is visible in the unfiltered
    // recent-withdrawals list, so the balance still drops by 50.
    expect(await card.findByText("$40.00")).toBeInTheDocument();
  });
});
