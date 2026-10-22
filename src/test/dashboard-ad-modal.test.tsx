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

// ApexCharts is loaded lazily and is browser-only; a stub keeps the route test
// focused on the dashboard layout and data.
vi.mock("react-apexcharts", () => ({
  default: ({ type }: { type?: string }) => <div data-testid="apex-chart" data-chart-type={type} />,
}));

// The real player resolves a remote VAST tag, which belongs in its own test
// file. Here we only need a deterministic way to report "video finished".
vi.mock("@/components/HilltopVideoAd", () => ({
  HilltopVideoAd: ({ onAdCompleted }: { onAdCompleted?: () => void }) => (
    <button type="button" onClick={() => onAdCompleted?.()}>
      Finish video ad
    </button>
  ),
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const query: Record<string, unknown> = {};
    const chain = () => query;
    Object.assign(query, {
      select: chain,
      eq: chain,
      in: chain,
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
  const finishVideo = () =>
    fireEvent.click(screen.getByRole("button", { name: "Finish video ad" }));

  it("stacks the Hilltop video ad above the Adsterra banner and explains the dual-ad gate", async () => {
    await openAdModal();

    expect(screen.queryByText(/Simulated Ad Playing/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Finish video ad" })).toBeInTheDocument();
    expect(screen.getByText("Complete both ads to claim your reward.")).toBeInTheDocument();

    const injected = document.querySelectorAll(`script[src="${AD_SRC}"]`);
    expect(injected).toHaveLength(1);
    expect(injected[0]?.parentElement?.className).toContain("h-[250px]");

    // One label for the video creative, one for the image creative.
    expect(screen.getAllByText("Sponsored")).toHaveLength(2);

    const videoSlot = screen.getByRole("button", { name: "Finish video ad" });
    const bannerSlot = document.querySelector(`script[src="${AD_SRC}"]`) as Element;
    expect(
      videoSlot.compareDocumentPosition(bannerSlot) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Long content must scroll inside the viewport on small screens.
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[90vh]");
    expect(dialog.className).toContain("overflow-y-auto");
  });

  it("keeps the 15 second countdown but withholds Claim until the video finishes", async () => {
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
    // Timer elapsed, video still unwatched: the reward stays locked.
    expect(screen.queryByRole("button", { name: "Claim $0.05" })).toBeNull();
    expect(screen.getByText(/Finish the video ad to unlock your reward/i)).toBeInTheDocument();
    expect(screen.getByText("video ad required")).toBeInTheDocument();
    // The banner stays mounted for the whole wait.
    expect(document.querySelectorAll(`script[src="${AD_SRC}"]`)).toHaveLength(1);

    await act(async () => {
      finishVideo();
    });

    expect(screen.getByRole("button", { name: "Claim $0.05" })).toBeInTheDocument();
    expect(screen.getByText("reward ready")).toBeInTheDocument();
  });

  it("does not reveal Claim when only the video has finished", async () => {
    await openAdModal({ fakeTimers: true });

    await act(async () => {
      finishVideo();
    });
    expect(screen.getByText("Video ad completed ✓")).toBeInTheDocument();

    for (let elapsed = 1; elapsed <= 14; elapsed += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.queryByRole("button", { name: "Claim $0.05" })).toBeNull();
    }

    // The 15th tick satisfies the timer half of the gate.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByRole("button", { name: "Claim $0.05" })).toBeInTheDocument();
  });
});
