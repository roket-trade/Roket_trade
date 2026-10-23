import type { ComponentType, ReactNode } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/routes/dashboard";

const { mockUser, mockProfile, planState } = vi.hoisted(() => ({
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
    phone_number: null,
    default_wallet_address: null,
    plan_started_at: null,
    plan_expires_at: null,
  },
  planState: { plan: null as string | null },
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
  Link: ({ children, to, hash }: { children: ReactNode; to?: string; hash?: string }) => (
    <a href={`${to ?? ""}${hash ? `#${hash}` : ""}`}>{children}</a>
  ),
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
}));

vi.mock("@/components/KycModal", () => ({ KycModal: () => null }));
vi.mock("@/components/HilltopVideoAd", () => ({ HilltopVideoAd: () => null }));
vi.mock("@/components/AdsterraBanner", () => ({ AdsterraBanner: () => null }));

vi.mock("react-apexcharts", () => ({
  default: () => <div data-testid="apex-chart" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

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
        const data =
          table === "transactions" && filters["type"] === "deposit" && planState.plan
            ? [
                {
                  plan_name: planState.plan,
                  deposit_amount: 180,
                  amount: 180,
                  created_at: new Date().toISOString(),
                },
              ]
            : [];
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

const LOCK_COPY = "Upgrade to Plan 2 or higher to unlock Ads Rewards.";

const adsCard = () => screen.getByTestId("ads-reward-card");

afterEach(() => {
  cleanup();
  planState.plan = null;
  vi.clearAllMocks();
});

describe("Ads Rewards plan gating", () => {
  it.each([null, "Plan 1"])("locks the card for %s", async (plan) => {
    planState.plan = plan;
    render(<DashboardPage />);

    const card = await screen.findByTestId("ads-reward-card");
    expect(await within(card).findByText(LOCK_COPY)).toBeInTheDocument();
    const upgrade = within(card).getByRole("link", { name: "Upgrade Plan" });
    expect(upgrade).toHaveAttribute("href", "/#pricing");
    // The blurred content is inert, so its button is disabled too.
    expect(within(card).getByRole("button", { name: "Watch Ads", hidden: true })).toBeDisabled();

    // Blurred inner content + absolute neon overlay.
    const blurred = card.querySelector(".blur-sm");
    expect(blurred?.className).toContain("pointer-events-none");
    expect(blurred?.className).toContain("opacity-50");
    const overlay = card.querySelector(".absolute.inset-0");
    expect(overlay?.className).toContain("z-10");
  });

  it.each(["Plan 2", "Plan 3", "Plan 4"])("unlocks the card for %s", async (plan) => {
    planState.plan = plan;
    render(<DashboardPage />);

    expect(await screen.findByText("Latest 5 Rewards")).toBeInTheDocument();
    const card = adsCard();
    expect(within(card).queryByText(LOCK_COPY)).toBeNull();
    expect(within(card).queryByRole("link", { name: "Upgrade Plan" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Watch Ads" })).toBeEnabled();
    expect(card.querySelector(".blur-sm")).toBeNull();
  });
});
