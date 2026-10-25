import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AuthShell } from "@/components/AuthShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => {
    const redirect =
      typeof s.redirect === "string" &&
      s.redirect.startsWith("/") &&
      !s.redirect.startsWith("//")
        ? s.redirect
        : "";
    return redirect ? { redirect } : {};
  },
  head: () => ({
    meta: [
      { title: "Log in — Roket" },
      { name: "description", content: "Log in to your Roket account." },
      { property: "og:title", content: "Log in — Roket" },
      { property: "og:description", content: "Log in to your Roket account." },
    ],
  }),
  component: Login,
});

const input =
  "w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

const SUSPENDED_MESSAGE = "Your account has been suspended. Please contact support.";

function Login() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      setBusy(false);
      setError(authError.message);
      return;
    }

    // Suspended users may still sign in; the AccountSuspendedOverlay blocks the
    // dashboard. Keep the profile probe (tolerating databases that have not
    // run the is_suspended migration yet) so login never crashes.
    const signedInId = authData.user?.id;
    if (signedInId) {
      const { error: profileError } = await supabase
        .from("profiles")
        .select("is_suspended")
        .eq("id", signedInId)
        .maybeSingle();
      if (profileError) {
        console.error(
          "[login] profile suspension check failed:",
          profileError.code,
          profileError.message,
        );
      }
      // Suspended users are allowed to sign in; the AccountSuspendedOverlay
      // blocks the UI on the dashboard. They may only sign out via the
      // overlay's "Sign out" button.
    }

    // Sanitize redirect: default to /dashboard if missing, /login, or /login?...
    let safeRedirect = search.redirect;
    if (
      !safeRedirect ||
      safeRedirect === "/login" ||
      safeRedirect.startsWith("/login?")
    ) {
      safeRedirect = "/dashboard";
    }

    navigate({ to: safeRedirect, replace: true });
  };

  return (
    <AuthShell>
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
          Welcome back
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold">Log in to Roket</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick up where you left off and keep your plans moving.
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            className={input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            className={input}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Logging in…" : "Log In"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to Roket?{" "}
        <Link to="/signup" className="font-semibold text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
