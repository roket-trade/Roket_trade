import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const hoisted = vi.hoisted(() => {
  const profiles = [
    {
      id: "admin-1",
      full_name: "Ada Admin",
      main_balance: 0,
      extra_balance: 0,
      kyc_status: "verified",
      plan_name: null,
      plan_started_at: null,
      plan_expires_at: null,
      is_admin: true,
      is_suspended: false,
      last_withdraw_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "user-1",
      full_name: "Alice Able",
      main_balance: 125.5,
      extra_balance: 10,
      kyc_status: "verified",
      plan_name: "Plan 2",
      plan_started_at: "2026-01-01T00:00:00.000Z",
      plan_expires_at: "2027-01-01T00:00:00.000Z",
      is_admin: false,
      is_suspended: false,
      last_withdraw_at: "2026-02-01T00:00:00.000Z",
      created_at: "2026-02-01T00:00:00.000Z",
    },
    {
      id: "user-2",
      full_name: "Bob Brown",
      main_balance: 0,
      extra_balance: 0,
      kyc_status: "pending",
      plan_name: null,
      plan_started_at: null,
      plan_expires_at: null,
      is_admin: false,
      is_suspended: true,
      last_withdraw_at: null,
      created_at: "2026-03-01T00:00:00.000Z",
    },
  ];

  // admin_user_aggregates() output: earned money only, never deposits.
  const aggregates = [
    {
      user_id: "admin-1",
      total_earned: 0,
      total_withdrawn: 0,
      available_balance: 0,
      referral_count: 0,
      earnings_adjustment: 0,
    },
    {
      user_id: "user-1",
      total_earned: 240,
      total_withdrawn: 40,
      available_balance: 200,
      referral_count: 2,
      earnings_adjustment: 0,
    },
    {
      user_id: "user-2",
      total_earned: 15,
      total_withdrawn: 0,
      available_balance: 15,
      referral_count: 0,
      earnings_adjustment: 5,
    },
  ];

  const transactions = [
    {
      id: "tx-1",
      user_id: "user-1",
      type: "daily_profit",
      amount: 12,
      deposit_amount: null,
      plan_name: "Daily Profit",
      network: null,
      wallet_address: null,
      tx_hash: null,
      status: "completed",
      created_at: "2026-02-02T00:00:00.000Z",
    },
    {
      id: "tx-2",
      user_id: "user-1",
      type: "withdrawal",
      amount: -50,
      deposit_amount: null,
      plan_name: "Withdraw to BEP20",
      network: "BEP20",
      wallet_address: "0xabc",
      tx_hash: "wd-1",
      status: "pending",
      created_at: "2026-02-03T00:00:00.000Z",
    },
  ];

  // Fixtures for the no-RPC fallback path (batched queries).
  const fallbackTransactions = [
    { user_id: "user-1", type: "daily_profit", amount: 300, status: "completed" },
    { user_id: "user-1", type: "referral_bonus", amount: 20, status: "completed" },
    { user_id: "user-1", type: "deposit", amount: 500, status: "completed" },
    { user_id: "user-1", type: "withdrawal", amount: -70, status: "pending" },
    { user_id: "user-1", type: "withdrawal", amount: -30, status: "rejected" },
  ];
  const fallbackReferrals = [
    { referred_by: "user-1" },
    { referred_by: "user-1" },
    { referred_by: null },
  ];

  return {
    profiles,
    aggregates,
    transactions,
    fallbackTransactions,
    fallbackReferrals,
    aggregateRpcError: false,
    emails: {
      "admin-1": "ada@example.com",
      "user-1": "alice@example.com",
      "user-2": "bob@example.com",
    } as Record<string, string>,
    updates: [] as {
      table: string;
      payload: Record<string, unknown>;
      column?: string | undefined;
      value?: unknown;
    }[],
    isAdmin: true,
    affectedRows: true,
    primaryEmailError: null as { code: string; message: string } | null,
    resetPassword: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  };
});

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: "/admin", searchStr: "" } }),
}));

vi.mock("@/components/RequireAdmin", () => ({
  RequireAdmin: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => {
  type Result = { data: unknown; error: unknown };

  const makeBuilder = (table: string, result: Result) => {
    const state: { column?: string; value?: unknown; payload?: Record<string, unknown> } = {};
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        state.column = column;
        state.value = value;
        return builder;
      },
      in: () => builder,
      order: () => builder,
      maybeSingle: () => Promise.resolve(result),
      update: (payload: Record<string, unknown>) => {
        state.payload = payload;
        return builder;
      },
      then: (
        onFulfilled: (value: Result) => unknown,
        onRejected?: (reason: unknown) => unknown,
      ) => {
        if (state.payload) {
          hoisted.updates.push({
            table,
            payload: state.payload,
            column: state.column,
            value: state.value,
          });
          // `.select("id")` after the update is how admin.tsx proves the write
          // landed; an empty array models an RLS-blocked UPDATE.
          const affected = hoisted.affectedRows ? { id: state.value } : null;
          return Promise.resolve({ data: affected ? [affected] : [], error: null }).then(
            onFulfilled,
            onRejected,
          );
        }
        // The transaction-history modal filters by user_id; the queue tabs use
        // type/status filters and keep returning their empty fixture.
        if (table === "transactions" && state.column === "user_id") {
          const rows = hoisted.transactions.filter((tx) => tx.user_id === state.value);
          return Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected);
        }
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  };

  const resultFor = (table: string, cols: string): Result => {
    if (table === "profiles" && cols.includes("is_suspended")) {
      return { data: hoisted.profiles, error: null };
    }
    if (table === "profiles" && cols === "is_admin") {
      return { data: { is_admin: hoisted.isAdmin }, error: null };
    }
    if (table === "profiles" && cols === "referred_by") {
      return { data: hoisted.fallbackReferrals, error: null };
    }
    if (table === "transactions" && cols === "user_id,type,amount,status") {
      return { data: hoisted.fallbackTransactions, error: null };
    }
    return { data: [], error: null };
  };

  return {
    supabase: {
      from: (table: string) => ({
        select: (cols: string) => makeBuilder(table, resultFor(table, cols)),
        update: (payload: Record<string, unknown>) =>
          makeBuilder(table, { data: null, error: null }).update(payload),
      }),
      rpc: (fn: string, args?: { ids?: string[] | null }) => {
        if (fn === "admin_user_aggregates") {
          if (hoisted.aggregateRpcError) {
            return Promise.resolve({
              data: null,
              error: {
                code: "PGRST202",
                message: "Could not find the function public.admin_user_aggregates(ids)",
              },
            });
          }
          const ids = args?.ids;
          const rows = ids
            ? hoisted.aggregates.filter((row) => ids.includes(row.user_id))
            : hoisted.aggregates;
          return Promise.resolve({ data: rows, error: null });
        }
        const ids = args?.ids ?? Object.keys(hoisted.emails);
        if (fn === "admin_user_emails" && hoisted.primaryEmailError) {
          return Promise.resolve({ data: null, error: hoisted.primaryEmailError });
        }
        return Promise.resolve({
          data: ids.map((id) => ({ id, email: hoisted.emails[id] ?? null })),
          error: null,
        });
      },
      auth: {
        getUser: () => Promise.resolve({ data: { user: { id: "admin-1" } }, error: null }),
        resetPasswordForEmail: hoisted.resetPassword,
        signOut: vi.fn(() => Promise.resolve({ error: null })),
      },
    },
  };
});

import { Route } from "@/routes/admin";

const Admin = (Route.options as unknown as { component: () => React.ReactElement }).component;

const rowFor = (email: string) => screen.getByText(email).closest("tr") as HTMLTableRowElement;

const firstUpdate = () => {
  const update = hoisted.updates[0];
  if (!update) throw new Error("expected the action to write a profile update");
  return update;
};

async function openUsersTab() {
  render(<Admin />);
  fireEvent.click(await screen.findByRole("button", { name: /Users \(3\)/ }));
}

/** Every row action now lives behind the collapsible Actions menu. */
function openActions(email: string) {
  fireEvent.click(within(rowFor(email)).getByRole("button", { name: "Actions" }));
}

describe("Admin user management tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updates.length = 0;
    hoisted.isAdmin = true;
    hoisted.affectedRows = true;
    hoisted.primaryEmailError = null;
    hoisted.aggregateRpcError = false;
  });

  it("shows earned totals, available balance and referrals — never deposit balances", async () => {
    await openUsersTab();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Alice Able")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Total Earned" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Available Balance" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Referrals" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Main Balance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Extra Balance" })).not.toBeInTheDocument();

    const alice = rowFor("alice@example.com");
    expect(within(alice).getByText("$240.00")).toBeInTheDocument();
    expect(within(alice).getByText("$200.00")).toBeInTheDocument();
    expect(within(alice).getByText("2")).toBeInTheDocument();
    expect(within(alice).getByText("Plan 2")).toBeInTheDocument();
    expect(within(alice).getByText("Active")).toBeInTheDocument();
    expect(within(rowFor("bob@example.com")).getByText("Held")).toBeInTheDocument();

    // The stored profile balances used to print here; a deposit must never
    // look like an editable balance again.
    expect(screen.queryByText("$125.50")).not.toBeInTheDocument();
    expect(screen.queryByText("$10.00")).not.toBeInTheDocument();
  });

  it("filters users by email or name", async () => {
    await openUsersTab();
    const search = screen.getByLabelText("Search users by email or name");

    fireEvent.change(search, { target: { value: "bob" } });
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByText("alice@example.com")).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "ALICE ABLE" } });
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.queryByText("bob@example.com")).not.toBeInTheDocument();
  });

  it("keeps every row action behind the Actions menu", async () => {
    await openUsersTab();

    expect(screen.queryByRole("button", { name: "View Transactions" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Manage Plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hold Account" })).not.toBeInTheDocument();

    openActions("alice@example.com");

    for (const name of [
      "View Transactions",
      "Reset Withdraw Limit",
      "Send Reset Password",
      "Hold Account",
      "Manage Plan",
      "Edit Balances & KYC",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("opens a user's transaction history with date, type, amount and status", async () => {
    await openUsersTab();
    openActions("alice@example.com");
    fireEvent.click(screen.getByRole("button", { name: "View Transactions" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Transaction history")).toBeInTheDocument();
    for (const header of ["Date", "Type", "Amount", "Status"]) {
      expect(within(dialog).getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(await within(dialog).findByText("daily profit")).toBeInTheDocument();
    expect(within(dialog).getByText("$12.00")).toBeInTheDocument();
    expect(within(dialog).getByText("-$50.00")).toBeInTheDocument();
    expect(within(dialog).getByText("withdrawal")).toBeInTheDocument();
    expect(within(dialog).getByText("pending")).toBeInTheDocument();
  });

  it("edits Total Earned / Available Balance only — no deposit or main balance field", async () => {
    await openUsersTab();
    openActions("alice@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Edit Balances & KYC" }));

    const dialog = await screen.findByRole("dialog");
    const earned = within(dialog).getByLabelText("Total Earned") as HTMLInputElement;
    const available = within(dialog).getByLabelText("Available Balance") as HTMLInputElement;

    expect(earned.value).toBe("240");
    expect(available.value).toBe("200");
    expect(within(dialog).queryByLabelText(/main balance/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/extra balance/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/deposit/i)).not.toBeInTheDocument();

    // Available = Total Earned - withdrawn, so the two stay in sync while typing.
    fireEvent.change(available, { target: { value: "275" } });
    expect((within(dialog).getByLabelText("Total Earned") as HTMLInputElement).value).toBe("315");

    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    expect(hoisted.updates[0]).toMatchObject({
      table: "profiles",
      payload: {
        earnings_adjustment: 75,
        main_balance: 200.5,
        is_admin: false,
        kyc_status: "verified",
      },
      column: "id",
      value: "user-1",
    });
    await waitFor(() =>
      expect(within(rowFor("alice@example.com")).getByText("$275.00")).toBeInTheDocument(),
    );
  });

  it("holds an active account and reflects it in the table", async () => {
    await openUsersTab();
    openActions("alice@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Hold Account" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    expect(hoisted.updates[0]).toMatchObject({
      table: "profiles",
      payload: { is_suspended: true },
      column: "id",
      value: "user-1",
    });
    await waitFor(() =>
      expect(within(rowFor("alice@example.com")).getByText("Held")).toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("resets the withdraw limit", async () => {
    await openUsersTab();
    openActions("alice@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Reset Withdraw Limit" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    expect(hoisted.updates[0]).toMatchObject({
      table: "profiles",
      payload: { last_withdraw_at: null },
      value: "user-1",
    });
  });

  it("sends a password reset email", async () => {
    await openUsersTab();
    openActions("alice@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Send Reset Password" }));

    await waitFor(() =>
      expect(hoisted.resetPassword).toHaveBeenCalledWith("alice@example.com", {
        redirectTo: `${window.location.origin}/update-password`,
      }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("updates a plan with a fresh 365-day window", async () => {
    await openUsersTab();
    openActions("alice@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Manage Plan" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Plan"), { target: { value: "Plan 4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Update Plan" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    const payload = firstUpdate().payload;
    expect(payload["plan_name"]).toBe("Plan 4");
    const started = new Date(payload["plan_started_at"] as string).getTime();
    const expires = new Date(payload["plan_expires_at"] as string).getTime();
    expect(Math.round((expires - started) / 86_400_000)).toBe(365);
    expect(firstUpdate().value).toBe("user-1");
  });

  it("cancels a plan by clearing the name and both dates", async () => {
    await openUsersTab();
    openActions("alice@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Manage Plan" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel Plan" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    expect(firstUpdate().payload).toEqual({
      plan_name: null,
      plan_started_at: null,
      plan_expires_at: null,
    });
  });

  it("falls back to get_all_user_emails when admin_user_emails is missing", async () => {
    hoisted.primaryEmailError = {
      code: "PGRST202",
      message: "Could not find the function public.admin_user_emails(ids)",
    };

    await openUsersTab();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.queryByText(/Emails unavailable/)).not.toBeInTheDocument();
  });

  it("computes the same aggregates with batched queries when the RPC is missing", async () => {
    hoisted.aggregateRpcError = true;

    await openUsersTab();

    const alice = rowFor("alice@example.com");
    // 300 daily profit + 20 referral bonus; the $500 deposit is ignored.
    expect(await within(alice).findByText("$320.00")).toBeInTheDocument();
    // 320 earned - 70 pending withdrawal; the rejected -30 is ignored.
    expect(within(alice).getByText("$250.00")).toBeInTheDocument();
    expect(within(alice).getByText("2")).toBeInTheDocument();
    expect(screen.queryByText(/Earnings unavailable/)).not.toBeInTheDocument();
  });

  it("reports an update that changed 0 rows instead of pretending it saved", async () => {
    await openUsersTab();
    hoisted.affectedRows = false;
    openActions("alice@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Hold Account" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("updated 0 rows")),
    );
    // No optimistic patch: the row still shows the stored value.
    expect(within(rowFor("alice@example.com")).getByText("Active")).toBeInTheDocument();
  });

  it("blocks the actions when the signed-in profile is not an admin", async () => {
    await openUsersTab();
    hoisted.isAdmin = false;
    openActions("alice@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Hold Account" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only admins can perform this action."),
    );
    expect(hoisted.updates).toHaveLength(0);
  });
});
