import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pathname: "/admin",
  searchStr: "",
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
  useRouterState: (options?: { select?: (snapshot: unknown) => unknown }) => {
    const snapshot = { location: { pathname: state.pathname, searchStr: state.searchStr } };
    return options?.select ? options.select(snapshot) : snapshot;
  },
}));

vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, session: null, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  },
}));

import { RequireAdmin } from "@/components/RequireAdmin";

const Child = () => <p>admin</p>;

afterEach(() => {
  cleanup();
  state.navigate.mockReset();
  state.searchStr = "";
});

describe("RequireAdmin logged-out redirect", () => {
  it("sends a logged-out visitor from /admin to /login with the path to return to", () => {
    state.pathname = "/admin";
    render(
      <RequireAdmin>
        <Child />
      </RequireAdmin>,
    );

    expect(state.navigate).toHaveBeenCalledTimes(1);
    expect(state.navigate).toHaveBeenCalledWith({
      to: "/login",
      search: { redirect: "/admin" },
      replace: true,
    });
  });

  it("does not redirect again while already on /login (no nested loop)", () => {
    state.pathname = "/login";
    state.searchStr = "?redirect=%2Fadmin";
    render(
      <RequireAdmin>
        <Child />
      </RequireAdmin>,
    );

    expect(state.navigate).not.toHaveBeenCalled();
  });
});
