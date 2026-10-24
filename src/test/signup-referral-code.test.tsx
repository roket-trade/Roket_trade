import type { ComponentType, ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "@/routes/signup";
import { buildReferralLink, readReferralCode } from "@/lib/referral";

const { routeOptions, routerState } = vi.hoisted(() => ({
  routeOptions: {} as { component?: ComponentType },
  routerState: { searchStr: "" },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    routeOptions.component = options.component;
    return options;
  },
  useNavigate: () => vi.fn(),
  useRouterState: (options?: { select?: (state: unknown) => unknown }) => {
    const state = {
      location: { pathname: "/signup", searchStr: routerState.searchStr },
    };
    return options?.select ? options.select(state) : state;
  },
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@/components/AuthShell", () => ({
  AuthShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signUp: vi.fn() },
    rpc: vi.fn(),
  },
}));

const SignupPage = () => {
  const Component = routeOptions.component;
  if (!Component) throw new Error("signup route component was not captured");
  return <Component />;
};

const setUrl = (search: string) => {
  window.history.replaceState({}, "", `/signup${search}`);
};

beforeEach(() => {
  routerState.searchStr = "";
  setUrl("");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("readReferralCode", () => {
  it("keeps an E-suffixed code strictly as a string", () => {
    // Number("80758E76") === 8.0758e+80 — the value must never be coerced.
    expect(readReferralCode("?ref=80758E76")).toBe("80758E76");
    expect(readReferralCode("ref=80758E76")).toBe("80758E76");
    expect(readReferralCode("?foo=1&ref=80758E76&bar=2")).toBe("80758E76");
  });

  it("returns an empty string when the parameter is missing", () => {
    expect(readReferralCode("")).toBe("");
    expect(readReferralCode(undefined)).toBe("");
    expect(readReferralCode("?ref=")).toBe("");
  });
});

describe("buildReferralLink", () => {
  it("builds the signup URL verbatim", () => {
    expect(buildReferralLink("80758E76")).toBe("https://roket.bond/signup?ref=80758E76");
    expect(buildReferralLink("")).toBe("");
    expect(buildReferralLink(null)).toBe("");
  });
});

describe("Signup referral auto-fill", () => {
  it("fills the referral input with the raw code, not scientific notation", () => {
    setUrl("?ref=80758E76");
    render(<SignupPage />);

    expect(screen.getByLabelText("Referral Code")).toHaveValue("80758E76");
    expect(screen.queryByDisplayValue("8.0758e+80")).toBeNull();
    expect(screen.getByText("Referral code filled from your invite link.")).toBeInTheDocument();
  });

  it("ignores the router's parsed search even when it reports the number form", () => {
    // The router's stringifySearch re-serializes the parsed number.
    routerState.searchStr = "?ref=8.0758e%2B80";
    setUrl("?ref=80758E76");
    render(<SignupPage />);

    expect(screen.getByLabelText("Referral Code")).toHaveValue("80758E76");
    expect(screen.queryByDisplayValue("8.0758e+80")).toBeNull();
  });

  it("leaves the referral input empty without a ref parameter", () => {
    setUrl("");
    render(<SignupPage />);

    expect(screen.getByLabelText("Referral Code")).toHaveValue("");
    expect(screen.queryByText("Referral code filled from your invite link.")).toBeNull();
  });
});
