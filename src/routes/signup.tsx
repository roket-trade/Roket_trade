import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { AuthShell } from "@/components/AuthShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/signup")({
  validateSearch: (s: Record<string, unknown>): { ref?: string } => {
    const ref = typeof s.ref === "string" ? s.ref.trim() : "";
    return ref ? { ref } : {};
  },
  head: () => ({
    meta: [
      { title: "Sign up — Roket" },
      { name: "description", content: "Create your Roket account and start trading." },
      { property: "og:title", content: "Sign up — Roket" },
      { property: "og:description", content: "Create your Roket account and start trading." },
    ],
  }),
  component: Signup,
});

const input =
  "w-full rounded-lg border border-border bg-muted/70 px-4 py-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20";

function Signup() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(search.ref ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (search.ref) setReferralCode(search.ref);
  }, [search.ref]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setNotice("");

    const cleanName = fullName.trim();
    const cleanEmail = email.trim();
    const cleanReferral = referralCode.trim().toUpperCase();

    if (!cleanName) {
      setError("Please enter your full name.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setBusy(true);

    try {
      let referredBy: string | null = null;
      if (cleanReferral) {
        const { data: referrerId } = await supabase.rpc("resolve_referral_code", {
          code: cleanReferral,
        });
        if (typeof referrerId === "string") referredBy = referrerId;
      }

      const { data, error: authError } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            full_name: cleanName,
            referral_code: cleanReferral || null,
            referred_by: referredBy,
          },
        },
      });

      if (authError) {
        setBusy(false);
        setError(authError.message);
        toast.error(authError.message);
        return;
      }

      if (!data.user) {
        setBusy(false);
        setError("We couldn't create your account. Please try again.");
        toast.error("We couldn't create your account. Please try again.");
        return;
      }

      if (data.user.identities && data.user.identities.length === 0) {
        setBusy(false);
        setError("An account with this email already exists. Try logging in.");
        toast.error("An account with this email already exists. Try logging in.");
        return;
      }

      if (data.session) {
        const { error: profileError } = await supabase.from("profiles").upsert(
          {
            id: data.user.id,
            full_name: cleanName,
            email: cleanEmail,
            referred_by: referredBy,
          },
          { onConflict: "id", ignoreDuplicates: true },
        );

        if (profileError) {
          setBusy(false);
          setError(profileError.message);
          toast.error(profileError.message);
          return;
        }

        setBusy(false);
        toast.success("Account created! Redirecting to your dashboard.");
        navigate({ to: "/dashboard", replace: true });
        return;
      }

      setBusy(false);
      setNotice("Account created. Check your email to confirm your address, then log in.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setBusy(false);
      setError(message);
      toast.error(message);
    }
  };

  return (
    <AuthShell>
      <div className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">Join Roket</p>
        <h1 className="mt-2 font-display text-3xl font-bold">Create your account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Start trading in minutes. Your account is free to create.
        </p>
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="full-name" className="text-sm font-medium">
            Full Name
          </label>
          <input
            id="full-name"
            className={input}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Alex Morgan"
            autoComplete="name"
            required
          />
        </div>

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
            placeholder="At least 6 characters"
            autoComplete="new-password"
            minLength={6}
            required
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="referral" className="text-sm font-medium">
              Referral Code
            </label>
            <span className="text-xs text-muted-foreground">Optional</span>
          </div>
          <input
            id="referral"
            className={input}
            value={referralCode}
            onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
            placeholder="Enter a friend's code"
            autoComplete="off"
            maxLength={20}
          />
          {search.ref && (
            <p className="text-xs text-primary">Referral code filled from your invite link.</p>
          )}
        </div>

        {error && (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}
        {notice && (
          <p className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">{notice}</p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-brand py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Creating account…" : "Sign Up"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-primary hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
