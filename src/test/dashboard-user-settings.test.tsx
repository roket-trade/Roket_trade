import type { ComponentType, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/routes/dashboard";

const { mockUser, mockProfile } = vi.hoisted(() => ({
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
    extra_balance: 0,
    main_balance: 10,
    kyc_status: "verified",
    referral_code: "TEST1234",
    referred_by: null,
    id_card_url: null,
    is_admin: false,
    address: null,
    last_withdraw_at: null,
    phone_number: "+1 555 010 2030",
    default_wallet_address: null,
    plan_started_at: null,
    plan_expires_at: null,
  },
}));

const {
  mockUpdateUser,
  mockSignOut,
  mockNavigate,
  mockUpdateProfile,
  mockToastSuccess,
  mockToastError,
} = vi.hoisted(() => ({
  mockUpdateUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
  mockSignOut: vi.fn(() => Promise.resolve({ error: null })),
  mockNavigate: vi.fn(),
  mockUpdateProfile: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}));

const { routeOptions } = vi.hoisted(() => ({
  routeOptions: {} as { component?: ComponentType },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    routeOptions.component = options.component;
    return options;
  },
  useNavigate: () => mockNavigate,
  useRouterState: () => ({ location: { pathname: "/dashboard", searchStr: "" } }),
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

vi.mock("@/components/KycModal", () => ({ KycModal: () => null }));
vi.mock("@/components/HilltopVideoAd", () => ({ HilltopVideoAd: () => null }));
vi.mock("@/components/AdsterraBanner", () => ({ AdsterraBanner: () => null }));

vi.mock("react-apexcharts", () => ({
  default: ({ type }: { type?: string }) => <div data-testid="apex-chart" data-chart-type={type} />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const query: Record<string, unknown> = {};
    const chain = () => query;
    Object.assign(query, {
      select: chain,
      eq: chain,
      in: chain,
      order: chain,
      limit: chain,
      insert: chain,
      update: (payload: Record<string, unknown>) => {
        mockUpdateProfile(payload);
        return query;
      },
      single: () => Promise.resolve({ data: mockProfile, error: null }),
      maybeSingle: () => Promise.resolve({ data: mockProfile, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    });
    return query;
  };

  return {
    supabase: {
      auth: {
        getUser: () => Promise.resolve({ data: { user: mockUser }, error: null }),
        signOut: mockSignOut,
        updateUser: mockUpdateUser,
      },
      from: () => builder(),
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
  vi.clearAllMocks();
});

describe("Dashboard user settings", () => {
  it("updates the phone number from the edit modal", async () => {
    render(<DashboardPage />);

    expect(await screen.findByText("+1 555 010 2030")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit phone number" }));
    expect(screen.getByRole("dialog", { name: "Edit Phone Number" })).toBeInTheDocument();

    const field = screen.getByLabelText("Phone Number");
    expect(field).toHaveValue("+1 555 010 2030");
    fireEvent.change(field, { target: { value: "+1 555 999 8888" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Phone Number" }));

    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({ phone_number: "+1 555 999 8888" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit Phone Number" })).toBeNull(),
    );
    expect(screen.getByText("+1 555 999 8888")).toBeInTheDocument();
    expect(mockToastSuccess).toHaveBeenCalledWith("Phone number updated.");
  });

  it("validates and updates the password via supabase.auth.updateUser", async () => {
    render(<DashboardPage />);
    await screen.findByText("+1 555 010 2030");

    fireEvent.click(screen.getByRole("button", { name: "Change Pass" }));
    expect(screen.getByRole("dialog", { name: "Change Password" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New Password"), { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "different123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Password" }));

    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith("Passwords do not match.");

    fireEvent.change(screen.getByLabelText("Confirm Password"), {
      target: { value: "secret123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update Password" }));

    await waitFor(() => expect(mockUpdateUser).toHaveBeenCalledWith({ password: "secret123" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Change Password" })).toBeNull(),
    );
    expect(mockToastSuccess).toHaveBeenCalledWith("Password updated successfully.");
  });

  it("signs out and returns to the landing page", async () => {
    render(<DashboardPage />);
    await screen.findByText("+1 555 010 2030");

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/", replace: true });
  });
});
