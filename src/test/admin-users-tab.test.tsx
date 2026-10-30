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

  // Fixtures for the All Transactions tab (latest 100, every type/status).
  const allTransactions = [
    {
      id: "all-1",
      user_id: "user-1",
      type: "deposit",
      amount: 500,
      deposit_amount: 500,
      plan_name: "Plan 2",
      network: "BEP20",
      wallet_address: "0xfeed",
      tx_hash: "0xabcdef1234567890abcdef1234567890",
      status: "completed",
      created_at: "2026-02-04T10:30:00.000Z",
    },
    {
      id: "all-2",
      user_id: "user-1",
      type: "withdrawal",
      amount: -50,
      deposit_amount: null,
      plan_name: "Withdraw to BEP20",
      network: "BEP20",
      wallet_address: "0xabc",
      tx_hash: "wd-1234567890abcdef",
      status: "pending",
      created_at: "2026-02-03T09:00:00.000Z",
    },
    {
      id: "all-3",
      user_id: "user-2",
      type: "referral_bonus",
      amount: 20,
      deposit_amount: null,
      plan_name: null,
      network: null,
      wallet_address: null,
      tx_hash: null,
      status: "completed",
      created_at: "2026-02-02T08:00:00.000Z",
    },
    {
      id: "all-4",
      user_id: "user-2",
      type: "ad_earning",
      amount: 1.5,
      deposit_amount: null,
      plan_name: null,
      network: null,
      wallet_address: null,
      tx_hash: null,
      status: "rejected",
      created_at: "2026-02-01T07:00:00.000Z",
    },
    {
      // Some rows store the withdrawal without a sign; it must still read as an
      // outflow (red, negative).
      id: "all-5",
      user_id: "user-2",
      type: "withdrawal",
      amount: 30,
      deposit_amount: null,
      plan_name: "Withdraw to SOL",
      network: "SOL",
      wallet_address: "3mjR",
      tx_hash: "wd-positive-sign",
      status: "completed",
      created_at: "2026-01-31T06:00:00.000Z",
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
    // Pristine copy: admin.tsx now reads a profile back after writing it, so
    // the fixture has to behave like the row would and be reset between tests.
    initialProfiles: profiles.map((p) => ({ ...p })),
    aggregates,
    transactions,
    allTransactions,
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
    // Pending deposits rendered on the Deposits tab (empty for every other test).
    pendingDeposits: [] as {
      id: string;
      user_id: string;
      type: string;
      amount: number;
      deposit_amount: number | null;
      plan_name: string | null;
      network: string | null;
      wallet_address: string | null;
      tx_hash: string | null;
      status: string;
      created_at: string;
    }[],
    // Pending withdrawals rendered on the Withdrawals tab.
    pendingWithdrawals: [] as {
      id: string;
      user_id: string;
      type: string;
      amount: number;
      deposit_amount: number | null;
      plan_name: string | null;
      network: string | null;
      wallet_address: string | null;
      tx_hash: string | null;
      status: string;
      created_at: string;
    }[],
    // supabase.functions.invoke — the send-push call under test.
    pushInvoke: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
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

  const makeBuilder = (table: string, result: Result, initialCols = "") => {
    const state: {
      cols: string;
      column?: string;
      value?: unknown;
      // `transactions.type` filter, so the deposits and withdrawals queues can
      // return different fixtures.
      type?: string;
      payload?: Record<string, unknown>;
      limited: boolean;
    } = { cols: initialCols, limited: false };

    // Profile balance reads resolve at call time against the live fixture:
    // admin.tsx re-reads the row it is about to diff against and again after
    // the update, so a snapshot taken when the builder was created would answer
    // with a stale balance.
    const currentResult = (): Result => {
      if (table === "profiles" && state.cols === "id,main_balance,extra_balance") {
        const id = typeof state.value === "string" ? state.value : "user-1";
        return {
          data: hoisted.profiles.find((profile) => profile.id === id) ?? null,
          error: null,
        };
      }
      return result;
    };

    const builder = {
      select: (cols?: string) => {
        state.cols = cols ?? "";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        state.column = column;
        state.value = value;
        if (column === "type") state.type = String(value);
        return builder;
      },
      in: () => builder,
      order: () => builder,
      limit: () => {
        state.limited = true;
        return builder;
      },
      maybeSingle: () => Promise.resolve(currentResult()),
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
          // A profile write lands on the fixture, so reading the row back (which
          // admin.tsx does to prove the value stuck) returns what was written.
          // A blocked UPDATE (affectedRows false) stores nothing, exactly like
          // the RLS-blocked write it models.
          if (table === "profiles" && hoisted.affectedRows && typeof state.value === "string") {
            const row = hoisted.profiles.find((profile) => profile.id === state.value);
            if (row) Object.assign(row, state.payload);
          }
          // `.select("id")` after the update is how admin.tsx proves the write
          // landed; an empty array models an RLS-blocked UPDATE.
          const affected = hoisted.affectedRows ? { id: state.value } : null;
          return Promise.resolve({ data: affected ? [affected] : [], error: null }).then(
            onFulfilled,
            onRejected,
          );
        }
        // Pending deposits queue (`type=deposit`, `status=pending`).
        if (table === "transactions" && state.type === "deposit") {
          return Promise.resolve({ data: hoisted.pendingDeposits, error: null }).then(
            onFulfilled,
            onRejected,
          );
        }
        // Pending withdrawals queue (`type=withdrawal`, `status=pending`).
        if (table === "transactions" && state.type === "withdrawal") {
          return Promise.resolve({ data: hoisted.pendingWithdrawals, error: null }).then(
            onFulfilled,
            onRejected,
          );
        }
        // The All Transactions tab asks for the latest 100 rows with no filter.
        if (
          table === "transactions" &&
          state.limited &&
          !state.cols.includes("profiles(email)")
        ) {
          return Promise.resolve({ data: hoisted.allTransactions, error: null }).then(
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
        return Promise.resolve(currentResult()).then(onFulfilled, onRejected);
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
    if (table === "profiles" && cols === "id,main_balance,extra_balance") {
      // The withdrawal rejection reads the row before refunding it.
      return { data: hoisted.profiles.find((p) => p.id === "user-1") ?? null, error: null };
    }
    if (table === "profiles" && cols === "referred_by") {
      return { data: hoisted.fallbackReferrals, error: null };
    }
    if (table === "transactions" && cols.includes("profiles(email)")) {
      // profiles has no email column in this database, so PostgREST rejects the
      // embed; admin.tsx must fall back to the plain select + email RPC.
      return {
        data: null,
        error: {
          code: "PGRST200",
          message:
            "Could not find a relationship between 'transactions' and 'profiles' in the schema cache",
        },
      };
    }
    if (table === "transactions" && cols === "user_id,type,amount,status") {
      return { data: hoisted.fallbackTransactions, error: null };
    }
    return { data: [], error: null };
  };

  return {
    supabase: {
      from: (table: string) => ({
        select: (cols: string) => makeBuilder(table, resultFor(table, cols), cols),
        update: (payload: Record<string, unknown>) =>
          makeBuilder(table, { data: null, error: null }).update(payload),
      }),
      // supabase.functions.invoke("send-push", …) used by the deposit approval.
      functions: { invoke: hoisted.pushInvoke },
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

// admin.tsx reads a profile back after writing it, and the mocked write-through
// below mutates these rows, so every test starts from the pristine fixture.
beforeEach(() => {
  hoisted.profiles.splice(
    0,
    hoisted.profiles.length,
    ...hoisted.initialProfiles.map((profile) => ({ ...profile })),
  );
});

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

  it("shows one Balance column, referrals and never a deposit amount", async () => {
    await openUsersTab();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Alice Able")).toBeInTheDocument();
    // A single Balance column: main_balance + extra_balance is the source of truth.
    expect(screen.getByRole("columnheader", { name: "Balance" })).toBeInTheDocument();
    // The transaction aggregate (earned - withdrawn) has its own header, so the
    // header row and the body rows line up.
    expect(screen.getByRole("columnheader", { name: "Net Earned" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Referrals" })).toBeInTheDocument();
    // The old split earned / available columns are gone.
    expect(screen.queryByRole("columnheader", { name: "Total Earned" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "Available Balance" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Main Balance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Extra Balance" })).not.toBeInTheDocument();

    const alice = rowFor("alice@example.com");
    // 125.50 main + 10.00 extra.
    expect(within(alice).getByText("$135.50")).toBeInTheDocument();
    // The transaction aggregate is still rendered next to it.
    expect(within(alice).getByText("$200.00")).toBeInTheDocument();
    expect(within(alice).getByText("2")).toBeInTheDocument();
    expect(within(alice).getByText("Plan 2")).toBeInTheDocument();
    expect(within(alice).getByText("Active")).toBeInTheDocument();
    expect(within(rowFor("bob@example.com")).getByText("Held")).toBeInTheDocument();

    // A deposit is never shown as (or editable as) a balance again.
    expect(screen.queryByText("$500.00")).not.toBeInTheDocument();

    // Every cell has a header: the header row and body rows must line up.
    const usersTable = alice.closest("table") as HTMLTableElement;
    const headerCount = within(usersTable).getAllByRole("columnheader").length;
    expect(within(alice).getAllByRole("cell")).toHaveLength(headerCount);
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

  it("edits the single Balance field and folds the difference into main_balance", async () => {
    await openUsersTab();
    openActions("alice@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Edit Balances & KYC" }));

    const dialog = await screen.findByRole("dialog");
    const balance = within(dialog).getByLabelText("Balance") as HTMLInputElement;

    // The field starts at main_balance + extra_balance: 125.50 + 10.00.
    expect(balance.value).toBe("135.5");
    expect(within(dialog).queryByLabelText(/total earned/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/available balance/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/extra balance/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/deposit/i)).not.toBeInTheDocument();

    fireEvent.change(balance, { target: { value: "275" } });

    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    // Only main_balance moves, by the delta: 125.50 + (275 - 135.50).
    expect(hoisted.updates[0]).toMatchObject({
      table: "profiles",
      payload: {
        main_balance: 265,
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

  it("diffs a balance edit against the database, not the page snapshot", async () => {
    await openUsersTab();
    openActions("alice@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Edit Balances & KYC" }));

    const dialog = await screen.findByRole("dialog");
    const balance = within(dialog).getByLabelText("Balance") as HTMLInputElement;

    // A credit (daily profit, referral bonus) landed after the page loaded, so
    // the row is now 40 main + 10 extra = 50 in the database.
    const alice = hoisted.profiles.find((profile) => profile.id === "user-1");
    if (alice) alice.main_balance = 40;

    fireEvent.change(balance, { target: { value: "60" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    // 60 requested against the database's 50 → main_balance moves by +10 to 50,
    // so the credit that arrived mid-edit is preserved instead of reverted.
    expect(hoisted.updates[0]).toMatchObject({
      table: "profiles",
      payload: {
        main_balance: 50,
        is_admin: false,
        kyc_status: "verified",
      },
      column: "id",
      value: "user-1",
    });
    await waitFor(() =>
      expect(within(rowFor("alice@example.com")).getByText("$60.00")).toBeInTheDocument(),
    );
  });

  it("writes once when Save changes is clicked twice", async () => {
    await openUsersTab();
    openActions("alice@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Edit Balances & KYC" }));

    const dialog = await screen.findByRole("dialog");
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    // The second click must not queue a second read → diff → write cycle.
    expect(hoisted.updates).toHaveLength(1);
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
    // The Balance cell stays on the profile figures: 125.50 main + 10.00 extra.
    expect(await within(alice).findByText("$135.50")).toBeInTheDocument();
    // 300 daily profit + 20 referral bonus; the $500 deposit is ignored. The
    // earned total survives in the aggregate cell's tooltip.
    expect(within(alice).getByText("$250.00")).toBeInTheDocument();
    expect(within(alice).getByTitle(/Earned \$320\.00/)).toBeInTheDocument();
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

describe("Admin panel layout and All Transactions tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updates.length = 0;
    hoisted.isAdmin = true;
    hoisted.affectedRows = true;
    hoisted.primaryEmailError = null;
    hoisted.aggregateRpcError = false;
  });

  const openTransactionsTab = async () => {
    render(<Admin />);
    const sidebar = screen.getByRole("navigation", { name: "Admin sections" });
    fireEvent.click(within(sidebar).getByRole("button", { name: /All Transactions/ }));
    return sidebar;
  };

  it("lists the sections in a left sidebar and drops the old description", async () => {
    render(<Admin />);

    const sidebar = screen.getByRole("navigation", { name: "Admin sections" });
    for (const name of [
      /Pending Deposits/,
      /Users/,
      /Pending Withdrawals/,
      /KYC Verifications/,
      /Support Tickets/,
      /Announcements/,
      /All Transactions/,
    ]) {
      expect(within(sidebar).getByRole("button", { name })).toBeInTheDocument();
    }

    expect(
      screen.queryByText(/Approve deposits \(pays 10% referral bonus\)/),
    ).not.toBeInTheDocument();
    // The refresh control now lives in the sidebar instead of the old tab row.
    expect(within(sidebar).getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("renders every recent transaction with email, type, amount, status and hash", async () => {
    await openTransactionsTab();

    for (const header of [
      "Date/Time",
      "User Email",
      "Type",
      "Amount",
      "Status",
      "Details",
    ]) {
      expect(await screen.findByRole("columnheader", { name: header })).toBeInTheDocument();
    }

    // Emails resolve through the admin_user_emails RPC because profiles has no
    // email column to embed.
    expect((await screen.findAllByText("bob@example.com")).length).toBe(3);

    const bonus = screen.getByText("Referral Bonus").closest("tr") as HTMLTableRowElement;
    expect(within(bonus).getByText("bob@example.com")).toBeInTheDocument();
    expect(within(bonus).getByText("$20.00")).toHaveClass("text-emerald-400");
    expect(within(bonus).getByText("completed")).toBeInTheDocument();
    expect(within(bonus).getByText("—")).toBeInTheDocument();

    const withdrawalAmount = screen.getByText("-$50.00");
    expect(withdrawalAmount).toHaveClass("text-destructive");
    const withdrawal = withdrawalAmount.closest("tr") as HTMLTableRowElement;
    expect(within(withdrawal).getByText("Withdrawal")).toBeInTheDocument();
    expect(within(withdrawal).getByText("pending")).toBeInTheDocument();
    expect(within(withdrawal).getByText("wd-1234567890a…")).toBeInTheDocument();
    expect(within(withdrawal).getByText("BEP20")).toBeInTheDocument();

    const adRow = screen.getByText("Ads Earning").closest("tr") as HTMLTableRowElement;
    expect(within(adRow).getByText("rejected")).toBeInTheDocument();
    expect(within(adRow).getByText("bob@example.com")).toBeInTheDocument();

    const deposit = screen.getByText("0xabcdef123456…").closest("tr") as HTMLTableRowElement;
    expect(within(deposit).getByText("$500.00")).toHaveClass("text-emerald-400");

    // A withdrawal stored without a sign still renders as a negative outflow.
    const unsignedWithdrawal = screen.getByText("-$30.00");
    expect(unsignedWithdrawal).toHaveClass("text-destructive");
    expect(
      within(unsignedWithdrawal.closest("tr") as HTMLTableRowElement).getByText("completed"),
    ).toBeInTheDocument();
  });

  it("counts the loaded transactions in the sidebar tab", async () => {
    await openTransactionsTab();

    expect(
      await screen.findByRole("button", { name: "All Transactions (5)" }),
    ).toBeInTheDocument();
  });
});

/**
 * Approving a pending deposit must fire the same `send-push` Edge Function the
 * withdrawals queue uses, but a failed push must never make the approval look
 * like it failed — the deposit is already completed and credited by then.
 */
describe("Admin deposit approval push", () => {
  const pendingDeposit = () => ({
    id: "dep-1",
    user_id: "user-1",
    type: "deposit",
    amount: 250,
    deposit_amount: 250,
    plan_name: "Plan 2",
    network: "BEP20",
    wallet_address: "0xfeed",
    tx_hash: "0xdeposit",
    status: "pending",
    created_at: "2026-02-05T00:00:00.000Z",
  });

  async function openDepositsTabAndApprove() {
    render(<Admin />);
    fireEvent.click(await screen.findByRole("button", { name: /Pending Deposits/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    // Approving now asks for confirmation before it moves money.
    fireEvent.click(await screen.findByRole("button", { name: "Yes, approve deposit" }));
  }

  const depositCompleted = () =>
    hoisted.updates.some(
      (update) => update.table === "transactions" && update.payload["status"] === "completed",
    );

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updates.length = 0;
    hoisted.pendingDeposits.length = 0;
    hoisted.pendingDeposits.push(pendingDeposit());
    hoisted.isAdmin = true;
    hoisted.affectedRows = true;
    hoisted.primaryEmailError = null;
    hoisted.aggregateRpcError = false;
  });

  it("pushes a confirmation to the depositor once the deposit is completed", async () => {
    await openDepositsTabAndApprove();

    await waitFor(() => expect(hoisted.pushInvoke).toHaveBeenCalledTimes(1));
    expect(hoisted.pushInvoke).toHaveBeenCalledWith("send-push", {
      body: {
        external_user_id: "user-1",
        title: "Deposit Confirmed",
        message: "Your deposit of $250 has been successfully confirmed and your plan is active.",
      },
    });
    expect(depositCompleted()).toBe(true);
    expect(toast.success).toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the deposit approved when the push request throws", async () => {
    hoisted.pushInvoke.mockRejectedValueOnce(new Error("push endpoint unavailable"));

    await openDepositsTabAndApprove();

    await waitFor(() => expect(hoisted.pushInvoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(depositCompleted()).toBe(true);
    // A push failure is logged, never surfaced as a failed approval.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the deposit approved when send-push answers with an error", async () => {
    hoisted.pushInvoke.mockResolvedValueOnce({
      data: null,
      error: { name: "FunctionsHttpError", message: "Unauthorized" },
    });

    await openDepositsTabAndApprove();

    await waitFor(() => expect(hoisted.pushInvoke).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(depositCompleted()).toBe(true);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

/**
 * Rejecting a withdrawal refunds the balance AND clears `last_withdraw_at`.
 * Leaving the timestamp set locked the user out for 7 days on a request that
 * never paid out, and the row actions used to run with no confirmation at all.
 */
describe("Admin withdrawal rejection", () => {
  const pendingWithdrawal = () => ({
    id: "wd-1",
    user_id: "user-1",
    type: "withdrawal",
    amount: -50,
    deposit_amount: null,
    plan_name: "Withdraw to BEP20",
    network: "BEP20",
    wallet_address: "0xabc",
    tx_hash: "wd-1",
    status: "pending",
    created_at: "2026-02-06T00:00:00.000Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updates.length = 0;
    hoisted.isAdmin = true;
    hoisted.affectedRows = true;
    hoisted.primaryEmailError = null;
    hoisted.aggregateRpcError = false;
    hoisted.pendingWithdrawals.length = 0;
    hoisted.pendingWithdrawals.push(pendingWithdrawal());
  });

  it("asks for confirmation before rejecting", async () => {
    render(<Admin />);
    fireEvent.click(await screen.findByRole("button", { name: /Pending Withdrawals/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reject + Refund" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // Nothing is written until the modal is confirmed.
    expect(hoisted.updates).toHaveLength(0);
  });

  it("refunds the balance and clears the 7-day cooldown", async () => {
    render(<Admin />);
    fireEvent.click(await screen.findByRole("button", { name: /Pending Withdrawals/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Reject + Refund" }));
    fireEvent.click(await screen.findByRole("button", { name: "Yes, reject + refund" }));

    await waitFor(() =>
      expect(
        hoisted.updates.some(
          (update) => update.table === "profiles" && update.payload["last_withdraw_at"] === null,
        ),
      ).toBe(true),
    );

    const profileUpdate = hoisted.updates.find((update) => update.table === "profiles");
    // 125.50 main + 50 refund, and the cooldown cleared in the same write.
    expect(profileUpdate?.payload).toMatchObject({ main_balance: 175.5, last_withdraw_at: null });
    expect(
      hoisted.updates.some(
        (update) => update.table === "transactions" && update.payload["status"] === "rejected",
      ),
    ).toBe(true);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});

/**
 * The approve confirmation must state the real payout. It read
 * `deposit_amount ?? amount`, and a withdrawal that stores `deposit_amount = 0`
 * kept the 0 (nullish coalescing accepts 0), so a $50 payout was confirmed as
 * "This marks $0.00 as paid out".
 */
describe("Admin withdrawal approval", () => {
  const pendingWithdrawal = (depositAmount: number | null) => ({
    id: "wd-1",
    user_id: "user-1",
    type: "withdrawal",
    amount: -50,
    deposit_amount: depositAmount,
    plan_name: "Withdraw to BEP20",
    network: "BEP20",
    wallet_address: "0xabc",
    tx_hash: "wd-1",
    status: "pending",
    created_at: "2026-02-06T00:00:00.000Z",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updates.length = 0;
    hoisted.isAdmin = true;
    hoisted.affectedRows = true;
    hoisted.primaryEmailError = null;
    hoisted.aggregateRpcError = false;
    hoisted.pendingWithdrawals.length = 0;
  });

  it("confirms with the real payout when the row stores deposit_amount = 0", async () => {
    hoisted.pendingWithdrawals.push(pendingWithdrawal(0));
    render(<Admin />);
    fireEvent.click(await screen.findByRole("button", { name: /Pending Withdrawals/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/This marks \$50\.00 as paid out/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("confirms with the real payout when the row carries no deposit_amount", async () => {
    hoisted.pendingWithdrawals.push(pendingWithdrawal(null));
    render(<Admin />);
    fireEvent.click(await screen.findByRole("button", { name: /Pending Withdrawals/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/This marks \$50\.00 as paid out/)).toBeInTheDocument();
  });
});
