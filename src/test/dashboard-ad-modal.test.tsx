import type { ComponentType, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Side-effect import: evaluating the route module registers its component with
// the createFileRoute mock below.
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

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const query: Record<string, unknown> = {};
    const chain = () => query;
    Object.assign(query, {
      select: chain,
      eq: chain,
      order: chain,
      limit: chain,
      insert: chain,
      update: chain,
      single: () =>
        Promise.resolve({ data: table === "profiles" ? mockProfile : null, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: table === "profiles" ? mockProfile : null, error: null }),
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
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

const AD_SRC = "https://bauval.org/22/6eb77e9fbeaacb703549a46c4e441ad3";

const DashboardPage = () => {
  const Component = routeOptions.component;
  if (!Component) throw new Error("dashboard route component was not captured");
  return <Component />;
};

async function openAdModal({ fakeTimers = false }: { fakeTimers?: boolean } = {}) {
  render(<DashboardPage />);
  const trigger = await screen.findByRole("button", { name: "Watch Ads" });
  // Swap to fake timers *before* the modal opens so the countdown's first
  // setTimeout is registered on the fake clock.
  if (fakeTimers) vi.useFakeTimers();
  fireEvent.click(trigger);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Watch Ads & Earn modal", () => {
  it("uses the real Adsterra banner instead of the simulated placeholder", async () => {
    await openAdModal();

    expect(screen.queryByText(/Simulated Ad Playing/i)).toBeNull();
    expect(screen.getByText(/Please wait while the ad loads/i)).toBeInTheDocument();

    const injected = document.querySelectorAll(`script[src="${AD_SRC}"]`);
    expect(injected).toHaveLength(1);
    expect(injected[0]?.parentElement?.className).toContain("h-[250px]");
  });

  it("keeps the 15 second countdown and reveals Claim only when it finishes", async () => {
    await openAdModal({ fakeTimers: true });

    expect(screen.getByText("15s")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claim $0.05" })).toBeNull();

    for (let elapsed = 1; elapsed <= 14; elapsed += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getByText(`${15 - elapsed}s`)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Claim $0.05" })).toBeNull();
    }

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.queryByText(/^\d+s$/)).toBeNull();
    expect(screen.getByRole("button", { name: "Claim $0.05" })).toBeInTheDocument();
    // The banner stays mounted for the whole wait.
    expect(document.querySelectorAll(`script[src="${AD_SRC}"]`)).toHaveLength(1);
  });
});
