import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  navigate: vi.fn(),
  search: {} as Record<string, string>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => mocks.search,
  }),
  Link: ({
    children,
    to,
    ...rest
  }: {
    children?: React.ReactNode;
    to?: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signUp: mocks.signUp },
    rpc: mocks.rpc,
    from: mocks.from,
  },
}));

import { Route } from "@/routes/signup";

const Signup = (Route.options as { component: () => React.ReactElement }).component;

function fillForm({ name, email, password, referral }: {
  name: string;
  email: string;
  password: string;
  referral?: string;
}) {
  fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  if (referral) {
    fireEvent.change(screen.getByLabelText("Referral Code"), { target: { value: referral } });
  }
}

describe("Signup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = {};
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "no rpc" } });
    mocks.from.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null }),
    });
  });

  it("creates the profile through the auth trigger instead of writing to profiles", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { id: "user-1", identities: [{ id: "user-1" }] },
        session: { access_token: "token" },
      },
      error: null,
    });

    const { container } = render(<Signup />);
    fillForm({ name: "Alex Morgan", email: "alex@example.com", password: "secret123" });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());

    // The on_auth_user_created trigger owns profile creation. A client-side
    // write trips the profiles RLS policies and blocks signup.
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.signUp).toHaveBeenCalledTimes(1);
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alex@example.com",
        password: "secret123",
        options: {
          data: expect.objectContaining({
            full_name: "Alex Morgan",
          }),
        },
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: "/dashboard" }),
    );
  });

  it("passes the referral code through the signup metadata for the trigger to resolve", async () => {
    mocks.signUp.mockResolvedValue({
      data: {
        user: { id: "user-2", identities: [{ id: "user-2" }] },
        session: { access_token: "token" },
      },
      error: null,
    });

    const { container } = render(<Signup />);
    fillForm({
      name: "Alex Morgan",
      email: "alex@example.com",
      password: "secret123",
      referral: "FRIEND1",
    });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());

    // The trigger resolves the referrer server-side, so the raw code travels
    // in the signup metadata instead of a client-side lookup.
    expect(mocks.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        options: {
          data: expect.objectContaining({
            full_name: "Alex Morgan",
            referral_code: "FRIEND1",
            referred_by: "FRIEND1",
          }),
        },
      }),
    );
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("surfaces sign up errors and stays on the signup page", async () => {
    mocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "User already registered" },
    });

    const { container } = render(<Signup />);
    fillForm({ name: "Alex Morgan", email: "alex@example.com", password: "secret123" });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() =>
      expect(screen.getByText("User already registered")).toBeInTheDocument(),
    );

    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});