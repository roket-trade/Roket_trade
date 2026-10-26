import type { ComponentType, ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/routes/__root";
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
    phone_number: null,
    default_wallet_address: null,
    plan_started_at: null,
    plan_expires_at: null,
  },
}));

const { routeOptions, rootRouteOptions } = vi.hoisted(() => ({
  routeOptions: {} as { component?: ComponentType },
  rootRouteOptions: {} as {
    component?: ComponentType;
    head?: (() => { scripts?: Array<{ children?: string }> }) | undefined;
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    routeOptions.component = options.component;
    return options;
  },
  createRootRouteWithContext:
    () =>
    (options: {
      component: ComponentType;
      head?: () => { scripts?: Array<{ children?: string }> };
    }) => {
      rootRouteOptions.component = options.component;
      rootRouteOptions.head = options.head;
      return {
        ...options,
        useRouteContext: () => ({ queryClient: new QueryClient() }),
      };
    },
  Outlet: () => <div data-testid="outlet" />,
  Scripts: () => null,
  HeadContent: () => null,
  useRouter: () => ({ invalidate: vi.fn() }),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { pathname: "/dashboard", searchStr: "" } }),
  Link: ({ children, to }: { children: ReactNode; to?: string }) => (
    <a href={to ?? ""}>{children}</a>
  ),
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser, loading: false }),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/PaymentVerificationProvider", () => ({
  PaymentVerificationProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/KycModal", () => ({ KycModal: () => null }));
vi.mock("@/components/HilltopVideoAd", () => ({ HilltopVideoAd: () => null }));
vi.mock("@/components/AdsterraBanner", () => ({ AdsterraBanner: () => null }));

vi.mock("react-apexcharts", () => ({
  default: () => <div data-testid="apex-chart" />,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  Toaster: () => null,
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

const DashboardPage = () => {
  const Component = routeOptions.component;
  if (!Component) throw new Error("dashboard route component was not captured");
  return <Component />;
};

beforeEach(() => {
  window.Tawk_API = { maximize: vi.fn() };
});

afterEach(() => {
  cleanup();
  delete window.Tawk_API;
  vi.restoreAllMocks();
});

describe("Tawk.to Live Chat", () => {
  it("hides the default bubble through CSS and no longer references Crisp", () => {
    const styles = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).toContain('iframe[title="chat widget"]');
    expect(styles).toMatch(/iframe\[title="chat widget"\]\s*{\s*display:\s*none\s*!important;/);
    expect(styles).not.toContain("#crisp-chatbox");
  });

  it("loads the Tawk.to embed script from the document head", () => {
    const head = rootRouteOptions.head?.();
    const scripts = head?.scripts ?? [];
    const inline = scripts.map((script) => script.children ?? "").join("\n");

    expect(inline).toContain("https://embed.tawk.to/6adfaf08762350347802ccfd/1k5ss7eo0");
    expect(inline).toContain("Tawk_API");
    expect(inline).toContain("Tawk_LoadStart");
  });

  it("opens the chat window from the dashboard Live Chat button", async () => {
    render(<DashboardPage />);

    const button = await screen.findByRole("button", { name: "Live Chat" });
    fireEvent.click(button);

    expect(window.Tawk_API?.maximize).toHaveBeenCalledTimes(1);
  });

  it("does nothing when Tawk.to has not loaded yet", async () => {
    delete window.Tawk_API;
    render(<DashboardPage />);

    const button = await screen.findByRole("button", { name: "Live Chat" });

    expect(() => fireEvent.click(button)).not.toThrow();
  });
});
