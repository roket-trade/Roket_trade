import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({
  updateUser: vi.fn(),
  exchange: vi.fn(),
  verifyOtp: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options }),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => (
    <a href={to}>{children}</a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      updateUser: mocks.updateUser,
      exchangeCodeForSession: mocks.exchange,
      verifyOtp: mocks.verifyOtp,
    },
  },
}));

import { Route } from "@/routes/update-password";

const UpdatePassword = (Route.options as unknown as { component: () => React.ReactElement })
  .component;

function fill(newPassword: string, confirmPassword: string) {
  fireEvent.change(screen.getByLabelText("New Password"), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText("Confirm New Password"), {
    target: { value: confirmPassword },
  });
}

function submit() {
  const button = screen.getByRole("button", { name: /update password/i });
  fireEvent.submit(button.closest("form") as HTMLFormElement);
}

describe("Update password page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
    mocks.exchange.mockResolvedValue({ data: {}, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("does not call Supabase when the two passwords differ", async () => {
    render(<UpdatePassword />);
    fill("new-secret-1", "new-secret-2");
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Passwords do not match."));
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("updates the password, confirms with a toast and redirects to the dashboard", async () => {
    render(<UpdatePassword />);
    fill("new-secret-1", "new-secret-1");
    submit();

    await waitFor(() =>
      expect(mocks.updateUser).toHaveBeenCalledWith({ password: "new-secret-1" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Password updated successfully!");
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true });
  });

  it("shows the exact Supabase error message and stays on the page", async () => {
    const message = "New password should be different from the old password.";
    mocks.updateUser.mockResolvedValue({ data: { user: null }, error: { message } });

    render(<UpdatePassword />);
    fill("new-secret-1", "new-secret-1");
    submit();

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("exchanges a PKCE recovery code from the email link for a session", async () => {
    window.history.replaceState({}, "", "/update-password?code=recovery-code");

    render(<UpdatePassword />);

    await waitFor(() => expect(mocks.exchange).toHaveBeenCalledWith("recovery-code"));
  });

  it("verifies a token_hash recovery link from the email", async () => {
    window.history.replaceState({}, "", "/update-password?token_hash=hash-123&type=recovery");

    render(<UpdatePassword />);

    await waitFor(() =>
      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-123", type: "recovery" }),
    );
  });

  it("reports an expired link instead of letting the update fail silently", async () => {
    window.history.replaceState(
      {},
      "",
      "/update-password?error_description=Email+link+is+invalid+or+has+expired",
    );

    render(<UpdatePassword />);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Email link is invalid or has expired"),
    );
  });
});
