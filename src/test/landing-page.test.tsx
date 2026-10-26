import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: authState.user, session: null, loading: false }),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => options,
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={to} data-testid={rest["data-testid"] as string | undefined}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/CandleChart", () => ({ CandleChart: () => <div data-testid="chart" /> }));
vi.mock("@/components/LiveTransactions", () => ({ LiveTransactions: () => null }));

import { Route } from "@/routes/index";

const Index = (Route as unknown as { component: () => ReactNode }).component;

function renderLanding() {
  render(<Index />);
}

function planCard(name: string) {
  const heading = screen.getByRole("heading", { name });
  return heading.parentElement as HTMLElement;
}

describe("Landing page", () => {
  beforeEach(() => {
    authState.user = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("sends logged-out visitors to signup from the hero", () => {
    renderLanding();

    expect(screen.getByTestId("hero-cta")).toHaveAttribute("href", "/signup");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Automated Crypto Trading Platform",
    );
  });

  it("sends signed-in visitors to the dashboard from the hero", () => {
    authState.user = { id: "user-1" };
    renderLanding();

    expect(screen.getByTestId("hero-cta")).toHaveAttribute("href", "/dashboard");
  });

  it("lists the four plans with the exact deposits and daily profits", () => {
    renderLanding();

    expect(within(planCard("Plan 1")).getByText("$60")).toBeInTheDocument();
    expect(within(planCard("Plan 1")).getByText("$1")).toBeInTheDocument();
    expect(within(planCard("Plan 2")).getByText("$120")).toBeInTheDocument();
    expect(within(planCard("Plan 2")).getByText("$3")).toBeInTheDocument();
    expect(within(planCard("Plan 3")).getByText("$180")).toBeInTheDocument();
    expect(within(planCard("Plan 3")).getByText("$4.50")).toBeInTheDocument();
    expect(within(planCard("Plan 4")).getByText("$250")).toBeInTheDocument();
    expect(within(planCard("Plan 4")).getByText("$8")).toBeInTheDocument();
    expect(screen.getByText(/All plans run for 365 days/)).toBeInTheDocument();
  });

  it("shows the ads rewards badge on plans 2, 3 and 4 only", () => {
    renderLanding();

    expect(within(planCard("Plan 1")).queryByText("Unlock Ads Rewards")).toBeNull();
    expect(within(planCard("Plan 2")).getByText("Unlock Ads Rewards")).toBeInTheDocument();
    expect(within(planCard("Plan 3")).getByText("Unlock Ads Rewards")).toBeInTheDocument();
    expect(within(planCard("Plan 4")).getByText("Unlock Ads Rewards")).toBeInTheDocument();
  });

  it("lists the current feature set", () => {
    renderLanding();

    for (const title of [
      "Auto Crypto Verification",
      "10% Referral Bonus",
      "Watch Ads & Earn",
      "Secure Withdrawals",
      "24/7 Live Chat Support",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText(/Supports USDT BEP20 & Solana/)).toBeInTheDocument();
    expect(screen.getByText(/Exclusive to Plan 2 and above/)).toBeInTheDocument();
    expect(screen.getByText(/reviewed before payout/)).toBeInTheDocument();
    expect(screen.queryByText(/7-day withdrawal cycle/)).toBeNull();
  });

  it("lists the five journey steps in order", () => {
    renderLanding();

    const section = screen
      .getByRole("heading", { name: "How It Works" })
      .closest("section") as HTMLElement;
    const steps = within(section)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);

    expect(steps).toEqual([
      "Create Account & Complete KYC",
      "Deposit USDT",
      "Choose a Plan",
      "Earn Daily Profits & Refer",
      "Withdraw Your Profits",
    ]);
  });

  it("opens the how-it-works video in a modal", () => {
    renderLanding();

    expect(screen.queryByTitle("How Roket works")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /watch video/i }));

    expect(screen.getByTitle("How Roket works")).toHaveAttribute(
      "src",
      expect.stringContaining("zwrojeC1iM8"),
    );

    fireEvent.click(screen.getByRole("button", { name: /close video/i }));

    expect(screen.queryByTitle("How Roket works")).toBeNull();
  });

  it("answers the crypto, withdrawal and referral questions", () => {
    renderLanding();

    expect(
      screen.getByText(/We accept USDT on BEP20 and Solana networks only/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Every 7 days, with a minimum of \$50 and maximum of \$200 per request/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Earn 10% of your referred user's deposit instantly/),
    ).toBeInTheDocument();
  });

  it("links the footer to terms, privacy, tickets and live chat", () => {
    renderLanding();

    expect(screen.getAllByRole("link", { name: "Terms of Service" })[0]).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getAllByRole("link", { name: "Privacy Policy" })[0]).toHaveAttribute(
      "href",
      "/privacy",
    );
    for (const ticket of screen.getAllByRole("link", { name: "Submit a Ticket" })) {
      expect(ticket).toHaveAttribute("href", "/login");
    }
    expect(screen.getAllByRole("button", { name: "Live Chat" })).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Support" })).toBeNull();
  });
});
