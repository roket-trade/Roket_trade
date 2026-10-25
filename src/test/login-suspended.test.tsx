import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  from: vi.fn(),
  navigate: vi.fn(),
  search: {} as Record<string, string>,
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useSearch: () => mocks.search,
  }),
  Link: ({ children, to }: { children?: React.ReactNode; to?: string }) => <a href={to}>{children}</a>,
  useNavigate: () => mocks.navigate,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signInWithPassword: mocks.signIn, signOut: mocks.signOut },
    from: mocks.from,
  },
}));

import { Route } from "@/routes/login";

const Login = (Route.options as unknown as { component: () => React.ReactElement }).component;

const SUSPENDED = "Your account has been suspended. Please contact support.";

function profileQuery(result: { data: unknown; error: unknown }) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
  };
  return builder;
}

function submitLogin(email = "trader@example.com", password = "secret123") {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.submit(screen.getByRole("button", { name: /log in/i }).closest("form") as HTMLFormElement);
}

describe("Login suspension check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = {};
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("signs a suspended user straight back out and explains why", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    mocks.from.mockReturnValue(profileQuery({ data: { is_suspended: true }, error: null }));

    render(<Login />);
    submitLogin();

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledTimes(1));

    expect(mocks.from).toHaveBeenCalledWith("profiles");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(SUSPENDED);
    expect(await screen.findByText(SUSPENDED)).toBeInTheDocument();
  });

  it("lets an active user through to the dashboard", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });
    mocks.from.mockReturnValue(profileQuery({ data: { is_suspended: false }, error: null }));

    render(<Login />);
    submitLogin("active@example.com");

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true }),
    );

    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("still logs in when the is_suspended column has not been deployed yet", async () => {
    mocks.signIn.mockResolvedValue({ data: { user: { id: "user-3" } }, error: null });
    mocks.from.mockReturnValue(
      profileQuery({
        data: null,
        error: { code: "42703", message: 'column profiles.is_suspended does not exist' },
      }),
    );

    render(<Login />);
    submitLogin("legacy@example.com");

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true }),
    );

    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
