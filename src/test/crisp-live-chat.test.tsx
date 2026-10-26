import type { ComponentType, ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/routes/__root";
import "@/routes/dashboard";

const { mockUser, mockProfile, crisp } = vi.hoisted(() => ({
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
  crisp: {
    configure: vi.fn(),
    chat: {
      hide: vi.fn(),
      show: vi.fn(),
      open: vi.fn(),
      close: vi.fn(),
      onChatClosed: vi.fn(),
      offChatClosed: vi.fn(),
    },
    user: {
      setEmail: vi.fn(),
      setNickname: vi.fn(),
    },
  },
}));

const { routeOptions, rootRouteOptions } = vi.hoisted(() => ({
  routeOptions: {} as { component?: ComponentType },
  rootRouteOptions: {} as { component?: ComponentType },
}));

vi.mock("crisp-sdk-web", () => ({ Crisp: crisp }));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    routeOptions.component = options.component;
    return options;
  },
  createRootRouteWithContext: () => (options: { component: ComponentType }) => {
    rootRouteOptions.component = options.component;
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

const RootPage = () => {
  const Component = rootRouteOptions.component;
  if (!Component) throw new Error("root route component was not captured");
  return <Component />;
};

beforeEach(() => {
  crisp.configure.mockClear();
  crisp.chat.hide.mockClear();
  crisp.chat.show.mockClear();
  crisp.chat.open.mockClear();
  crisp.chat.onChatClosed.mockClear();
  crisp.chat.offChatClosed.mockClear();
  crisp.user.setEmail.mockClear();
  crisp.user.setNickname.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Crisp Live Chat", () => {
  it("hides the widget through the SDK instead of CSS, so open() is not overridden", () => {
    const styles = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(styles).not.toContain("#crisp-chatbox");
    expect(styles).not.toMatch(/display:\s*none\s*!important/);
  });

  it("configures Crisp once and keeps the default bubble hidden until the chat closes", () => {
    render(<RootPage />);

    expect(crisp.configure).toHaveBeenCalledWith("31ab4ec2-ac77-432d-9d61-234b2b91f7b9");
    expect(crisp.chat.hide).toHaveBeenCalledTimes(1);
    expect(crisp.chat.onChatClosed).toHaveBeenCalledTimes(1);

    const onClosed = crisp.chat.onChatClosed.mock.calls.at(0)?.[0] as (() => void) | undefined;
    expect(onClosed).toBeTypeOf("function");
    onClosed?.();
    expect(crisp.chat.hide).toHaveBeenCalledTimes(2);
  });

  it("opens the chat window from the dashboard button", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    render(<DashboardPage />);

    const button = await screen.findByRole("button", { name: "Live Chat" });
    fireEvent.click(button);

    expect(log).toHaveBeenCalledWith("Live Chat button clicked");
    expect(crisp.user.setEmail).toHaveBeenCalledWith("trader@example.com");
    expect(crisp.user.setNickname).toHaveBeenCalledWith("Test Trader");

    // Visibility is restored before opening: the widget is hidden by the SDK,
    // and opening a hidden chatbox leaves the chat window invisible.
    expect(crisp.chat.show).toHaveBeenCalledTimes(1);
    expect(crisp.chat.open).toHaveBeenCalledTimes(1);
    const showOrder = crisp.chat.show.mock.invocationCallOrder[0] ?? 0;
    const openOrder = crisp.chat.open.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
    expect(showOrder).toBeLessThan(openOrder);

    await waitFor(() => expect(crisp.chat.open).toHaveBeenCalled());
  });
});
