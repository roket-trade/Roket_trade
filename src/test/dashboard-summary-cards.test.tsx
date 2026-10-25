import type { ComponentType, ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "@/routes/dashboard";
import { createPlatformStats } from "@/lib/platform-stats";

const { mockUser, mockProfile, startDate } = vi.hoisted(() => ({
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
    extra_balance: 20,
    main_balance: 250,
    kyc_status: "verified",
    referral_code: "TEST1234",
    referred_by: null,
    id_card_url: null,
    is_admin: false,
    address: null,
    last_withdraw_at: null,
    phone_number: "+1 555 010 2030",
    default_wallet_address: "0x35aec7E35F65ea227e49fDd321709D52Ada389E4",
    plan_started_at: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString(),
    plan_expires_at: new Date(Date.now() + 321 * 24 * 60 * 60 * 1000).toISOString(),
  },
  startDate: new Date(Date.now() - 44 * 24 * 60 * 60 * 1000).toISOString(),
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
  default: ({ type }: { type?: string }) => <div data-testid="apex-chart" data-chart-type={type} />,
}));

// Returns fixture rows per transaction type so the dashboard's aggregate
// queries (ads, referral bonuses, withdrawals, active plan) can be asserted.
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
      in: (column: string, values: string[]) => {
        filters[column] = values.join(",");
        return query;
      },
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
        if (table === "transactions") {
          if (filters["type"] === "daily_profit") {
            data = [{ amount: 9.5 }];
          } else if (filters["type"] === "ad_earning") {
            data = [
              { id: "ad-1", amount: 0.1, created_at: "2026-09-01T00:00:00.000Z" },
              { id: "ad-2", amount: 0.05, created_at: "2026-09-02T00:00:00.000Z" },
            ];
          } else if (filters["type"] === "referral_bonus") {
            data = [{ id: "rb-1", amount: 12, created_at: "2026-09-03T00:00:00.000Z" }];
          } else if (filters["type"] === "withdrawal") {
            data = [
              {
                id: "wd-1",
                amount: -50,
                created_at: "2026-09-04T00:00:00.000Z",
                wallet_address: "0x35aec7E35F65ea227e49fDd321709D52Ada389E4",
                status: "pending",
              },
            ];
          } else if (filters["type"] === "deposit") {
            data = [
              {
                plan_name: "Plan 3",
                deposit_amount: 180,
                amount: 180,
                created_at: startDate,
              },
            ];
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Dashboard top summary cards", () => {
  it("renders totals, plan progress and withdrawal aggregates in a 3-column glass grid", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { container } = render(<DashboardPage />);

    expect(await screen.findByText("Total Balance")).toBeInTheDocument();

    // Card 1 — Total Balance is earned money only (daily profit + ads + referrals),
    // never the user's deposit or wallet balance.
    expect(screen.getByText("$21.65")).toBeInTheDocument();
    expect(screen.getByText("Main $9.50 · Extra $12.15")).toBeInTheDocument();
    expect(screen.getByText("+$9.50 ($4.50/day)")).toBeInTheDocument();
    expect(screen.getByText("+$0.15")).toBeInTheDocument();
    expect(screen.getByText("+$12.00")).toBeInTheDocument();

    // Top intro copy and its KYC line were removed; KYC now lives in User Control.
    expect(screen.queryByText(/Your account is ready/)).toBeNull();
    expect(screen.queryByText(/Member since/)).toBeNull();
    expect(screen.getByText("KYC Verified")).toBeInTheDocument();

    // Card 2 — active plan from the latest completed deposit.
    expect(screen.getAllByText("Plan 3").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("$180.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Day 45 / 365")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "Plan progress" });
    expect(progress).toHaveAttribute("aria-valuenow", "45");
    expect(progress.firstElementChild?.className).toContain("bg-gradient-to-r");

    // Card 3 — completed withdrawals + truncated default wallet.
    expect(screen.getByText("Total withdrawn")).toBeInTheDocument();
    expect(screen.getAllByText("$50.00").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("0x35...89E4")).toBeInTheDocument();

    // Live candlestick chart + platform-wide profit/loss stats.
    expect(screen.getByText("Live Chart")).toBeInTheDocument();
    expect(screen.getByText("Random Market")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Live Roket market candlestick chart" }),
    ).toBeInTheDocument();
    const chart = await screen.findByTestId("apex-chart");
    expect(chart).toHaveAttribute("data-chart-type", "candlestick");

    expect(screen.getByText("Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("Platform Loss")).toBeInTheDocument();
    expect(screen.getByText("Today Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("This Week Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("This Month Platform Profit")).toBeInTheDocument();
    expect(screen.getByText("Today Platform Loss")).toBeInTheDocument();
    expect(screen.getByText("This Week Platform Loss")).toBeInTheDocument();
    expect(screen.getByText("This Month Platform Loss")).toBeInTheDocument();

    // Platform stats are seeded by the current date, so they are stable across
    // refreshes instead of re-rolling on every mount.
    const stats = createPlatformStats();
    const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
    expect(await screen.findByText(`+${usd(stats.today.profit)}`)).toBeInTheDocument();
    expect(screen.getByText(`-${usd(stats.today.loss)}`)).toBeInTheDocument();
    expect(screen.getByText(`+${usd(stats.week.profit)}`)).toBeInTheDocument();
    expect(screen.getByText(`-${usd(stats.week.loss)}`)).toBeInTheDocument();
    expect(screen.getByText(`+${usd(stats.month.profit)}`)).toBeInTheDocument();
    expect(screen.getByText(`-${usd(stats.month.loss)}`)).toBeInTheDocument();
    expect(screen.getByText("These are Roket platform statistics.")).toBeInTheDocument();

    // Plan 3 is ads-eligible: the card stays fully interactive.
    const adsCard = screen.getByTestId("ads-reward-card");
    expect(
      within(adsCard).queryByText("Upgrade to Plan 2 or higher to unlock Ads Rewards."),
    ).toBeNull();
    expect(within(adsCard).queryByRole("link", { name: "Upgrade Plan" })).toBeNull();
    expect(within(adsCard).getByRole("button", { name: "Watch Ads" })).toBeEnabled();

    // Bottom 4-column grid.
    expect(screen.getByRole("heading", { name: "Ads Reward" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Watch Ads" })).toBeInTheDocument();
    expect(screen.getByText("Latest 5 Rewards")).toBeInTheDocument();
    expect(screen.getByText("+$0.10")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Referral" })).toBeInTheDocument();
    expect(screen.getByText("TEST1234")).toBeInTheDocument();
    expect(screen.getByText("Alice Referral")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.getByText("Available Balance")).toBeInTheDocument();
    expect(screen.getByText("Latest 5 Withdrawals")).toBeInTheDocument();
    expect(screen.getByText("-$50.00")).toBeInTheDocument();
    expect(screen.getByText("One withdrawal every 7 days.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set Wallet" })).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "User Control" })).toBeInTheDocument();
    expect(screen.getByText("trader@example.com")).toBeInTheDocument();
    expect(screen.getByText("+1 555 010 2030")).toBeInTheDocument();
    expect(screen.getByText("Plan Summary")).toBeInTheDocument();
    expect(screen.getByText("Total Profit")).toBeInTheDocument();
    expect(screen.getByText("+$9.50")).toBeInTheDocument();
    expect(screen.getByText("365 Days")).toBeInTheDocument();
    expect(screen.getByText("Upgrade Plan")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel Plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();

    const bottomGrid = container.querySelector('[class*="lg:grid-cols-4"]');
    expect(bottomGrid?.className).toContain("md:grid-cols-2");
    expect(bottomGrid?.children).toHaveLength(4);

    // Footer notification + help boxes.
    const notification = screen.getByRole("heading", { name: "Notification" }).closest("section");
    expect(notification?.className).toContain("border-l-blue-500");
    expect(
      screen.getByText("System maintenance scheduled for Oct 25, 02:00 UTC"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Referral bonus increased to 10% for a limited time!"),
    ).toBeInTheDocument();

    const help = screen.getByRole("heading", { name: "Need Help?" }).closest("section");
    expect(help?.className).toContain("border-l-rose-500");
    expect(screen.getByRole("link", { name: "Message on Telegram" })).toHaveAttribute(
      "href",
      "https://t.me/roket_trade",
    );
    expect(screen.getByRole("link", { name: "Submit A Ticket" })).toHaveAttribute(
      "href",
      "mailto:info@roket.bond?subject=Support%20Ticket",
    );
    expect(screen.getByRole("link", { name: "Email Us: info@roket.bond" })).toHaveAttribute(
      "href",
      "mailto:info@roket.bond",
    );

    // "Set Wallet" opens the wallet-management modal. It is prefilled from the
    // legacy single default address and saves every network plus the default.
    fireEvent.click(screen.getByRole("button", { name: "Set Wallet" }));
    const walletDialog = screen.getByRole("dialog", { name: "Saved Wallets" });
    expect(walletDialog).toBeInTheDocument();
    const bep20Field = within(walletDialog).getByLabelText("BEP20 Address");
    expect(bep20Field).toHaveValue("0x35aec7E35F65ea227e49fDd321709D52Ada389E4");
    fireEvent.change(bep20Field, { target: { value: "0xnewWalletAddress" } });
    fireEvent.click(within(walletDialog).getByRole("button", { name: "Save Wallets" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Saved Wallets" })).toBeNull());

    // The saved address is also what the withdrawal flow targets, so a legacy
    // default_wallet_address keeps withdrawals working.
    fireEvent.click(screen.getByRole("button", { name: "Withdraw" }));
    const withdrawDialog = screen.getByRole("dialog", { name: "Request Withdrawal" });
    expect(within(withdrawDialog).getByText("0xne...ress (BEP20)")).toBeInTheDocument();

    // Dark glassmorphism styling + responsive 3-column grid.
    const grid = container.querySelector(".mt-8.grid");
    expect(grid?.className).toContain("md:grid-cols-3");
    expect(grid?.children).toHaveLength(3);
    for (const card of Array.from(grid?.children ?? [])) {
      expect(card.className).toContain("bg-gray-900/50");
      expect(card.className).toContain("border-gray-800");
      expect(card.className).toContain("backdrop-blur");
    }
  });
});

describe("Platform statistics seeding", () => {
  it("returns identical stats for the same day and keeps losses 8-10x below profits", () => {
    const first = createPlatformStats();
    // Same date seed on every call — a refresh must not re-roll the numbers.
    for (let i = 0; i < 5; i += 1) {
      expect(createPlatformStats()).toEqual(first);
    }

    expect(first.today.profit).toBeGreaterThanOrEqual(10_000);
    expect(first.today.profit).toBeLessThanOrEqual(50_000);
    expect(first.week.profit).toBeGreaterThanOrEqual(first.today.profit * 5);
    expect(first.month.profit).toBeGreaterThanOrEqual(first.week.profit * 4);

    for (const window of [first.today, first.week, first.month]) {
      const ratio = window.profit / window.loss;
      expect(ratio).toBeGreaterThanOrEqual(8);
      expect(ratio).toBeLessThanOrEqual(10.01);
    }

    // The seed rolls over on the next calendar day.
    const tomorrow = createPlatformStats(new Date(Date.now() + 24 * 60 * 60 * 1000));
    expect(tomorrow.today).not.toEqual(first.today);
    expect(tomorrow.today.profit).toBeGreaterThanOrEqual(10_000);
    expect(tomorrow.today.profit).toBeLessThanOrEqual(50_000);
  });
});
