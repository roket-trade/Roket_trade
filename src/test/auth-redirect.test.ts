import { describe, expect, it } from "vitest";

import { loginRedirectSearch } from "@/lib/auth-redirect";

// Regression: a guard that ran while the browser was already on /login appended
// that /login URL as the redirect value, so the login page bounced to itself and
// the address bar grew /login?redirect=%2Flogin%3Fredirect%3D…
describe("loginRedirectSearch", () => {
  it("never sends the user back to /login", () => {
    expect(loginRedirectSearch("/login", "")).toEqual({});
    expect(loginRedirectSearch("/login", "?redirect=%2Fadmin")).toEqual({});
    expect(loginRedirectSearch("/login/", "")).toEqual({});
  });

  it("strips an existing redirect param instead of nesting it", () => {
    expect(loginRedirectSearch("/dashboard", "?redirect=%2Flogin%3Fredirect%3D%252Fadmin")).toEqual(
      { redirect: "/dashboard" },
    );
    // Other params on the guarded page survive.
    expect(loginRedirectSearch("/checkout", "?plan=3&redirect=%2Fadmin")).toEqual({
      redirect: "/checkout?plan=3",
    });
  });

  it("carries the guarded path (and its search) once for a real page", () => {
    expect(loginRedirectSearch("/admin", "")).toEqual({ redirect: "/admin" });
    expect(loginRedirectSearch("/checkout", "?plan=3")).toEqual({ redirect: "/checkout?plan=3" });
  });
});
