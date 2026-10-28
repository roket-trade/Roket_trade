import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: false,
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: authState.user, session: null, loading: authState.loading }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...rest
  }: { to: string; children: ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { NotFoundPage } from "@/components/NotFoundPage";

describe("NotFoundPage", () => {
  beforeEach(() => {
    authState.user = null;
    authState.loading = false;
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the 404 message and a link home for anonymous visitors", () => {
    render(<NotFoundPage />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("404");
    expect(screen.getByRole("heading", { name: "Lost in Space?" })).toBeInTheDocument();
    expect(
      screen.getByText(/The page you are looking for doesn't exist or has been moved/i),
    ).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /Back to Home/i })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: /Go to Dashboard/i })).not.toBeInTheDocument();
  });

  it("shows the dashboard shortcut only when a user is signed in", () => {
    authState.user = { id: "user-1" };
    render(<NotFoundPage />);

    expect(screen.getByRole("link", { name: /Go to Dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("hides the dashboard shortcut while the session is still loading", () => {
    authState.user = { id: "user-1" };
    authState.loading = true;
    render(<NotFoundPage />);

    expect(screen.queryByRole("link", { name: /Go to Dashboard/i })).not.toBeInTheDocument();
  });
});
