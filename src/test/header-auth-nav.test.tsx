import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HeaderAuthNav } from "@/components/HeaderAuthNav";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => authState,
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

describe("HeaderAuthNav", () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders nothing while the session is loading", () => {
    authState.loading = true;
    render(<HeaderAuthNav current="home" />);

    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows a single Login / Signup button when logged out", () => {
    render(<HeaderAuthNav current="home" />);

    expect(screen.getByRole("link", { name: "Login / Signup" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByText(/log ?out/i)).toBeNull();
  });

  it("shows Dashboard on the home page when logged in", () => {
    authState.user = { id: "user-1" };
    render(<HeaderAuthNav current="home" />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull();
    expect(screen.queryByText(/log ?out/i)).toBeNull();
  });

  it("shows Home on the dashboard page when logged in", () => {
    authState.user = { id: "user-1" };
    render(<HeaderAuthNav current="dashboard" />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByText(/log ?out/i)).toBeNull();
  });

  it("shows Home and Dashboard on other pages when logged in", () => {
    authState.user = { id: "user-1" };
    render(<HeaderAuthNav current="other" />);

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
    expect(screen.queryByText(/log ?out/i)).toBeNull();
  });
});
