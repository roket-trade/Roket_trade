import { useEffect, useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AuthShell } from "@/components/AuthShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/update-password")({
  // Deliberately public: this page is opened straight from the Supabase
  // password-recovery email, before a usable session exists. Wrapping it in
  // RequireAuth would bounce the user to /login and lose the recovery token.
  head: () => ({
    meta: [
      { title: "Update password — Roket" },
      { name: "description", content: "Choose a new password for your Roket account." },
      { property: "og:title", content: "Update password — Roket" },
      { property: "og:description", content: "Choose a new password for your Roket account." },
    ],
  }),
  component: UpdatePassword,
});

const input =
  "w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

type RecoveryParams = {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  errorDescription: string | null;
};

// Supabase recovery links arrive in one of three shapes:
//   #access_token=…&type=recovery          (implicit — supabase-js detects it)
//   ?code=…                                (PKCE)
//   ?token_hash=…&type=recovery            (custom email template + verifyOtp)
// Read them straight off window.location because the fragment is never sent
// to the router.
function readRecoveryParams(): RecoveryParams {
  if (typeof window === "undefined") {
    return { code: null, tokenHash: null, type: null, errorDescription: null };
  }
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return {
    code: search.get("code"),
    tokenHash: search.get("token_hash"),
    type: search.get("type") ?? hash.get("type"),
    errorDescription: search.get("error_description") ?? hash.get("error_description"),
  };
}

function UpdatePassword() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const handledLink = useRef(false);

  // A PKCE code or token_hash has to be turned into a session before
  // updateUser can succeed. Implicit links (#access_token=…) are already
  // handled by supabase-js when the client is created, so there is nothing to
  // do for those.
  useEffect(() => {
    if (handledLink.current) return;
    handledLink.current = true;

    const { code, tokenHash, type, errorDescription } = readRecoveryParams();

    if (errorDescription) {
      setError(errorDescription);
      toast.error(errorDescription);
      return;
    }
    if (!code && !(tokenHash && type === "recovery")) return;

    setVerifying(true);
    const verifyLink = async () => {
      try {
        if (code && typeof supabase.auth.exchangeCodeForSession === "function") {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          // supabase-js may have already consumed the code from the URL; if a
          // session now exists the link is fine even though this call failed.
          if (exchangeError) {
            const existing =
              typeof supabase.auth.getSession === "function"
                ? await supabase.auth.getSession()
                : undefined;
            if (!existing?.data?.session) throw new Error(exchangeError.message);
          }
        } else if (tokenHash) {
          const { error: otpError } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: "recovery",
          });
          if (otpError) throw new Error(otpError.message);
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "This password reset link is invalid or has expired.";
        setError(message);
        toast.error(message);
      } finally {
        setVerifying(false);
      }
    };
    void verifyLink();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError("");

    if (newPassword !== confirmPassword) {
      const message = "Passwords do not match.";
      setError(message);
      toast.error(message);
      return;
    }

    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        setError(updateError.message);
        toast.error(updateError.message);
        return;
      }
      setNewPassword("");
      setConfirmPassword("");
      toast.success("Password updated successfully!");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't update your password.";
      setError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell>
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
          Almost there
        </p>
        <h1 className="mt-2 font-display text-3xl font-bold">Set a new password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Choose a new password for your account, then sign straight back in.
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="new-password" className="text-sm font-medium">
            New Password
          </label>
          <input
            id="new-password"
            className={input}
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Your new password"
            autoComplete="new-password"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm-password" className="text-sm font-medium">
            Confirm New Password
          </label>
          <input
            id="confirm-password"
            className={input}
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat your new password"
            autoComplete="new-password"
            required
          />
        </div>

        {verifying && (
          <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
            Verifying your reset link…
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Updating password…" : "Update Password"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Back to log in
        </Link>
      </p>
    </AuthShell>
  );
}
