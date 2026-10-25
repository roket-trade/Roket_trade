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

  return {
    profiles,
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
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: "/admin", searchStr: "" } }),
}));

vi.mock("@/components/RequireAdmin", () => ({
  RequireAdmin: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
      order: () => builder,
      maybeSingle: () => Promise.resolve(result),
      update: (payload: Record<string, unknown>) => {
        state.payload = payload;
        return builder;
      },
      then: (onFulfilled: (value: Result) => unknown, onRejected?: (reason: unknown) => unknown) => {
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

describe("Admin user management tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.updates.length = 0;
    hoisted.isAdmin = true;
    hoisted.affectedRows = true;
    hoisted.primaryEmailError = null;
  });

  it("lists every user with balances, plan, KYC and account status", async () => {
    await openUsersTab();

    expect(await screen.findByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("Alice Able")).toBeInTheDocument();
    expect(screen.getByText("$125.50")).toBeInTheDocument();
    expect(screen.getByText("$10.00")).toBeInTheDocument();
    expect(screen.getByText("Plan 2")).toBeInTheDocument();
    expect(within(rowFor("alice@example.com")).getByText("Active")).toBeInTheDocument();
    expect(within(rowFor("bob@example.com")).getByText("Held")).toBeInTheDocument();
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

  it("holds an active account and reflects it in the table", async () => {
    await openUsersTab();

    fireEvent.click(within(rowFor("alice@example.com")).getByRole("button", { name: "Hold Account" }));

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

    fireEvent.click(
      within(rowFor("alice@example.com")).getByRole("button", { name: "Reset Withdraw Limit" }),
    );

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    expect(hoisted.updates[0]).toMatchObject({
      table: "profiles",
      payload: { last_withdraw_at: null },
      value: "user-1",
    });
  });

  it("sends a password reset email", async () => {
    await openUsersTab();

    fireEvent.click(
      within(rowFor("alice@example.com")).getByRole("button", { name: "Send Reset Password" }),
    );

    await waitFor(() =>
      expect(hoisted.resetPassword).toHaveBeenCalledWith("alice@example.com", {
        redirectTo: `${window.location.origin}/update-password`,
      }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("updates a plan with a fresh 365-day window", async () => {
    await openUsersTab();

    fireEvent.click(within(rowFor("alice@example.com")).getByRole("button", { name: "Manage Plan" }));
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

    fireEvent.click(within(rowFor("alice@example.com")).getByRole("button", { name: "Manage Plan" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel Plan" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    expect(firstUpdate().payload).toEqual({
      plan_name: null,
      plan_started_at: null,
      plan_expires_at: null,
    });
  });

  it("edits balances, the admin flag and KYC status", async () => {
    await openUsersTab();

    fireEvent.click(
      within(rowFor("bob@example.com")).getByRole("button", { name: "Edit Balances & KYC" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Main balance"), { target: { value: "500" } });
    fireEvent.change(within(dialog).getByLabelText("Extra balance"), { target: { value: "25.25" } });
    fireEvent.change(within(dialog).getByLabelText("KYC status"), { target: { value: "verified" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(hoisted.updates).toHaveLength(1));
    expect(hoisted.updates[0]).toMatchObject({
      table: "profiles",
      payload: {
        main_balance: 500,
        extra_balance: 25.25,
        is_admin: false,
        kyc_status: "verified",
      },
      column: "id",
      value: "user-2",
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

  it("reports an update that changed 0 rows instead of pretending it saved", async () => {
    await openUsersTab();
    hoisted.affectedRows = false;

    fireEvent.click(within(rowFor("alice@example.com")).getByRole("button", { name: "Hold Account" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("updated 0 rows")),
    );
    // No optimistic patch: the row still shows the stored value.
    expect(within(rowFor("alice@example.com")).getByText("Active")).toBeInTheDocument();
  });

  it("blocks the actions when the signed-in profile is not an admin", async () => {
    await openUsersTab();
    hoisted.isAdmin = false;

    fireEvent.click(within(rowFor("alice@example.com")).getByRole("button", { name: "Hold Account" }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Only admins can perform this action."),
    );
    expect(hoisted.updates).toHaveLength(0);
  });
});
