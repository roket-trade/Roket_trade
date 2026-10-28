import type { ComponentType, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/routes/dashboard";

/**
 * Dashboard withdrawal balance.
 *
 * The reported bug: requesting a withdrawal left the Available Balance on the
 * dashboard untouched until a manual reload. These tests pin the whole chain —
 * the pending-withdrawal query the Promise.all issues, the total it produces,
 * the `totalBalance - totalDeposited - totalPendingWithdrawals` formula, and the
 * immediate state update after a request is submitted.
 */

const { WALLET, state } = vi.hoisted(() => {
  const wallet = "0x35aec7E35F65ea227e49fDd321709D52Ada389E4";
  return {
    WALLET: wallet,
    state: {
      // 250 main + 50 extra = 300 earned, 180 deposited → 120 available.
      profile: {
        id: "11111111-2222-3333-4444-555555555555",
        full_name: "Test Trader",
        created_at: "2024-01-01T00:00:00.000Z",
        main_balance: 250,
        extra_balance: 50,
        kyc_status: "verified",
        referral_code: "TEST1234",
        referred_by: null,
        is_admin: false,
        address: null,
        phone_number: "+1 555 010 2030",
        last_withdraw_at: null as string | null,
        plan_name: "Plan 3",
        plan_started_at: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString(),
        plan_expires_at: new Date(Date.now() + 321 * 24 * 60 * 60 * 1000).toISOString(),
        default_wallet_address: wallet as string | null,
        default_wallet_type: "bep20",
        saved_wallets: null,
      },
      deposited: 180,
      pendingWithdrawals: [] as Array<Record<string, unknown>>,
      completedWithdrawals: [] as Array<Record<string, unknown>>,
      inserts: [] as Array<Record<string, unknown>>,
      /** Forces the `profiles` cooldown write to fail. */
      profileUpdateError: null as null | { message: string; code?: string },
      /** Forces the pending-withdrawal SELECT to fail (RLS/network). */
      pendingReadError: null as null | {
        message: string;
        code?: string;
        details?: string | null;
        hint?: string | null;
      },
      /** Simulates RLS returning an empty result for the new pending row. */
      hidePendingFromReads: false,
      /** When set, pending-withdrawal reads wait for `open()` before resolving. */
      pendingReadGate: null as null | { promise: Promise<void>; open: () => void },
    },
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
  useAuth: () => ({
    user: {
      id: "11111111-2222-3333-4444-555555555555",
      email: "trader@example.com",
      created_at: "2024-01-01T00:00:00.000Z",
      user_metadata: { full_name: "Test Trader" },
    },
    loading: false,
  }),
}));

vi.mock("@/components/KycModal", () => ({ KycModal: () => null }));
vi.mock("@/components/HilltopVideoAd", () => ({ HilltopVideoAd: () => null }));
vi.mock("@/components/AdsterraBanner", () => ({ AdsterraBanner: () => null }));
vi.mock("react-apexcharts", () => ({ default: () => <div data-testid="apex-chart" /> }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => {
  type Row = Record<string, unknown>;

  const builder = (table: string) => {
    const filters: Record<string, string> = {};
    const query: Record<string, unknown> = {};
    const chain = () => query;
    let updatePatch: Row | null = null;

    const rowsFor = (): Row[] => {
      if (table !== "transactions") return [];

      const type = filters["type"] ?? "";
      if (type === "daily_profit") return [{ amount: 12 }];
      if (type.includes("ad_earning")) return [];
      if (type === "referral_bonus") return [];
      if (type === "deposit") {
        return [{ plan_name: "Plan 3", deposit_amount: state.deposited, amount: state.deposited }];
      }
      if (type === "withdrawal") {
        // Mirrors the two dashboard queries: completed (totalWithdrawn) and
        // pending (totalPendingWithdrawals).
        return filters["status"] === "pending"
          ? state.pendingWithdrawals
          : state.completedWithdrawals;
      }
      return [];
    };

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
      insert: (row: Row) => {
        state.inserts.push({ table, ...row });
        if (table === "transactions" && row["type"] === "withdrawal") {
          state.pendingWithdrawals = [
            {
              id: `wd-${state.pendingWithdrawals.length + 1}`,
              amount: Number(row["amount"]),
              created_at: String(row["created_at"]),
              status: "pending",
              wallet_address: String(row["wallet_address"] ?? ""),
            },
            ...state.pendingWithdrawals,
          ];
        }
        return query;
      },
      update: (patch: Row) => {
        updatePatch = patch;
        return query;
      },
      single: () =>
        Promise.resolve({ data: table === "profiles" ? state.profile : null, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: table === "profiles" ? state.profile : null, error: null }),
      then: (resolve: (value: unknown) => unknown) => {
        if (table === "profiles" && updatePatch) {
          if (state.profileUpdateError) {
            return Promise.resolve({ data: null, error: state.profileUpdateError }).then(resolve);
          }
          Object.assign(state.profile, updatePatch);
        }

        const result = { data: rowsFor(), error: null };
        const isPendingWithdrawalRead = table === "transactions" && filters["status"] === "pending";

        if (isPendingWithdrawalRead && state.pendingReadError) {
          return Promise.resolve({ data: null, error: state.pendingReadError }).then(resolve);
        }
        if (isPendingWithdrawalRead && state.hidePendingFromReads) {
          // RLS-style filtering: the query succeeds but the row is invisible.
          return Promise.resolve({ data: [], error: null }).then(resolve);
        }
        if (isPendingWithdrawalRead && state.pendingReadGate) {
          // Simulate a slow read so the test can prove the UI already dropped
          // the balance before the refetch returns.
          return state.pendingReadGate.promise.then(() => result).then(resolve);
        }
        return Promise.resolve(result).then(resolve);
      },
    });

    return query;
  };

  return {
    supabase: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: {
              user: {
                id: "11111111-2222-3333-4444-555555555555",
                email: "trader@example.com",
                created_at: "2024-01-01T00:00:00.000Z",
                user_metadata: { full_name: "Test Trader" },
              },
            },
            error: null,
          }),
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

/** The dashboard renders a spinner until the profile load resolves. */
async function findWithdrawCard(): Promise<HTMLElement> {
  const heading = await screen.findByRole("heading", { name: "Withdraw" });
  return heading.closest("section") as HTMLElement;
}

beforeEach(() => {
  state.deposited = 180;
  state.pendingWithdrawals = [];
  state.completedWithdrawals = [];
  state.inserts = [];
  state.profileUpdateError = null;
  state.pendingReadError = null;
  state.hidePendingFromReads = false;
  state.pendingReadGate = null;
  state.profile.last_withdraw_at = null;
  state.profile.default_wallet_address = WALLET;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Drives the withdraw modal end to end with `amount`. */
async function submitWithdrawal(card: HTMLElement, amount: number) {
  fireEvent.click(within(card).getByRole("button", { name: "Withdraw" }));
  await screen.findByText(/Available balance: \$/);

  fireEvent.change(screen.getByLabelText("Withdrawal Amount (USD)"), {
    target: { value: String(amount) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit Withdrawal" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

  await waitFor(() => expect(state.inserts).toHaveLength(1));
}

describe("Dashboard withdrawal balance", () => {
  it("subtracts every pending withdrawal from the available balance", async () => {
    // Two pending requests must both count, not just the newest one.
    state.pendingWithdrawals = [
      { id: "wd-1", amount: -50, created_at: "2026-10-01T00:00:00.000Z", status: "pending" },
      { id: "wd-2", amount: -20, created_at: "2026-10-02T00:00:00.000Z", status: "pending" },
    ];

    render(<DashboardPage />);

    // 300 earned − 180 deposited − 70 pending = 50.
    expect(await within(await findWithdrawCard()).findByText("$50.00")).toBeInTheDocument();
  });

  it("drops the available balance the moment a withdrawal is submitted", async () => {
    render(<DashboardPage />);
    const card = await findWithdrawCard();
    // 300 earned − 180 deposited − 0 pending = 120.
    expect(await within(card).findByText("$120.00")).toBeInTheDocument();

    // Hold the post-submit read so the assertion below can only pass because
    // the dashboard updated its own state, not because a refetch came back.
    let openGate: () => void = () => {};
    state.pendingReadGate = {
      promise: new Promise<void>((resolve) => {
        openGate = resolve;
      }),
      open: () => openGate(),
    };

    await submitWithdrawal(card, 50);

    // The request went in as a pending debit.
    expect(state.inserts[0]).toMatchObject({
      table: "transactions",
      type: "withdrawal",
      amount: -50,
      status: "pending",
    });

    // Balance dropped instantly: 300 − 180 − 50 = 70.
    await waitFor(() => expect(within(card).getByText("$70.00")).toBeInTheDocument());

    // Releasing the (slow) refetch reconciles to the same figure.
    state.pendingReadGate.open();
    await waitFor(() => expect(within(card).getByText("$70.00")).toBeInTheDocument());
    expect(within(card).queryByText("$120.00")).toBeNull();
  });

  it("still records the request and drops the balance when the cooldown stamp fails", async () => {
    state.profileUpdateError = {
      message: "new row violates row-level security policy",
      code: "42501",
    };

    render(<DashboardPage />);
    const card = await findWithdrawCard();
    expect(await within(card).findByText("$120.00")).toBeInTheDocument();

    await submitWithdrawal(card, 50);

    expect(state.inserts).toHaveLength(1);
    await waitFor(() => expect(within(card).getByText("$70.00")).toBeInTheDocument());
  });

  it("keeps the balance down when RLS hides the new pending row", async () => {
    // The production symptom: the SELECT succeeds but filters the row out, so
    // the server-reported pending total is 0. The balance must not spring back.
    state.hidePendingFromReads = true;

    render(<DashboardPage />);
    const card = await findWithdrawCard();
    expect(await within(card).findByText("$120.00")).toBeInTheDocument();

    await submitWithdrawal(card, 50);

    await waitFor(() => expect(within(card).getByText("$70.00")).toBeInTheDocument());
    // Give the refetch time to land, then re-check: it must not restore $120.00.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(card).getByText("$70.00")).toBeInTheDocument();
    expect(within(card).queryByText("$120.00")).toBeNull();
  });

  it("keeps the balance down and logs loudly when the pending read errors", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    state.pendingReadError = {
      message: "permission denied for table transactions",
      code: "42501",
    };

    render(<DashboardPage />);
    const card = await findWithdrawCard();
    expect(await within(card).findByText("$120.00")).toBeInTheDocument();

    await submitWithdrawal(card, 50);

    await waitFor(() => expect(within(card).getByText("$70.00")).toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(card).getByText("$70.00")).toBeInTheDocument();
    expect(
      consoleError.mock.calls.some(([first]) =>
        String(first).includes("pending withdrawals fetch failed"),
      ),
    ).toBe(true);
  });
});
