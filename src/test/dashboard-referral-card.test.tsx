import type { ComponentType, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    main_balance: 0,
    kyc_status: "verified",
    referral_code: "80758E76",
    referred_by: null,
    id_card_url: null,
    is_admin: false,
    address: null,
    last_withdraw_at: null,
    phone_number: null,
    default_wallet_address: null,
    plan_name: null,
    plan_started_at: null,
    plan_expires_at: null,
  },
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
  default: () => <div data-testid="apex-chart" />,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Referral bonuses: two linked to the referred user "ref-1" ($6.00 + $2.00) and
// one legacy row with no referred_user_id ($3.00) that must not be attributed.
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
      in: chain,
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
          data = [
            {
              id: "ref-1",
              full_name: "Alice Referral",
              created_at: "2026-09-05T00:00:00.000Z",
            },
          ];
        }
        if (table === "transactions" && filters["type"] === "referral_bonus") {
          data = [
            { amount: 6, created_at: "2026-09-06T00:00:00.000Z", referred_user_id: "ref-1" },
            { amount: 2, created_at: "2026-09-07T00:00:00.000Z", referred_user_id: "ref-1" },
            { amount: 3, created_at: "2026-09-08T00:00:00.000Z" },
          ];
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

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DashboardPage = () => {
  const Component = routeOptions.component;
  if (!Component) throw new Error("dashboard route component was not captured");
  return <Component />;
};

const referralCard = () => {
  const card = screen.getByRole("heading", { name: "Referral" }).closest("section");
  if (!card) throw new Error("referral card not found");
  return card;
};

describe("Dashboard referral card", () => {
  it("shows the 10% bonus earned from each referred user", async () => {
    render(<DashboardPage />);

    expect(await screen.findByText("Alice Referral")).toBeInTheDocument();
    const card = within(referralCard());

    // Linked bonuses are summed per referred user; the unlinked legacy row is
    // excluded from the per-user amount.
    expect(card.getByText("+$8.00")).toBeInTheDocument();
    expect(card.queryByText("+$11.00")).toBeNull();
  });

  it("copies the exact referral URL from the Copy Link button", async () => {
    render(<DashboardPage />);

    await screen.findByText("Alice Referral");
    expect(
      within(referralCard()).getByText("https://roket.bond/signup?ref=80758E76"),
    ).toBeInTheDocument();

    fireEvent.click(within(referralCard()).getByRole("button", { name: "Copy Link" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://roket.bond/signup?ref=80758E76");
    });
    expect(toast.success).toHaveBeenCalledWith("Referral link copied");
  });

  it("copies just the code from the Copy button", async () => {
    render(<DashboardPage />);

    await screen.findByText("Alice Referral");
    fireEvent.click(within(referralCard()).getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("80758E76");
    });
    expect(toast.success).toHaveBeenCalledWith("Referral code copied");
  });
});
