import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import logo from "@/assets/roket-logo.png.asset.json";
import { RequireAuth } from "@/components/RequireAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Roket" },
      { name: "description", content: "Manage your Roket account, referral link, and plans." },
      { property: "og:title", content: "Dashboard — Roket" },
      { property: "og:description", content: "Manage your Roket account, referral link, and plans." },
    ],
  }),
  component: Dashboard,
});

type Profile = Tables<"profiles">;

function Dashboard() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}

function DashboardContent() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const {
        data: { user: currentUser },
      } = await supabase.auth.getUser();
      if (!active) return;

      setUser(currentUser);

      if (currentUser) {
        const { data } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", currentUser.id)
          .maybeSingle();
        if (!active) return;
        setProfile(data);
      }

      if (active) setLoading(false);
    };

    load();

    return () => {
      active = false;
    };
  }, []);

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    navigate({ to: "/login", replace: true });
  };

  const fullName =
    profile?.full_name ??
    (typeof user?.user_metadata?.["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : "Trader");
  const email = user?.email ?? profile?.email ?? "";
  const referralCode = profile?.referral_code ?? "";
  const referralLink =
    referralCode && typeof window !== "undefined"
      ? `${window.location.origin}/signup?ref=${referralCode}`
      : "";
  const memberSince = profile?.created_at ?? user?.created_at;

  const copyReferral = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      toast.success("Referral link copied");
    } catch {
      toast.error("Couldn't copy — please copy it manually");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/">
            <img src={logo.url} alt="Roket" className="h-9" />
          </Link>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        {loading ? (
          <div className="flex min-h-[50vh] items-center justify-center">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-muted border-t-primary" />
          </div>
        ) : (
          <>
            <section>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                Dashboard
              </p>
              <h1 className="mt-2 font-display text-4xl font-bold">Welcome back, {fullName}</h1>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                Your account is ready. Choose a plan, submit your deposit, and our team will
                verify it manually.
              </p>
            </section>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <section className="rounded-2xl border bg-card p-5">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Account</p>
                <p className="mt-3 truncate font-display text-lg font-bold">{fullName}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{email}</p>
                <p className="mt-4 text-xs text-muted-foreground">
                  {memberSince
                    ? `Member since ${new Date(memberSince).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}`
                    : "Member"}
                </p>
              </section>

              <section className="rounded-2xl border bg-card p-5 md:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-muted-foreground">
                      Your referral code
                    </p>
                    <p className="mt-2 font-display text-2xl font-bold tracking-[0.15em] text-primary">
                      {referralCode || "PENDING"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={copyReferral}
                    disabled={!referralLink}
                    className="rounded-lg border border-primary px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Copy link
                  </button>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Share your invite link and grow your network.
                </p>
                {referralLink && (
                  <code className="mt-3 block break-all rounded-lg border bg-muted px-3 py-2 text-xs text-muted-foreground">
                    {referralLink}
                  </code>
                )}
              </section>
            </div>

            <section className="mt-6 rounded-2xl border border-primary/40 bg-card p-6 shadow-glow">
              <div className="flex flex-wrap items-center justify-between gap-5">
                <div>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    Next step
                  </p>
                  <h2 className="mt-1 font-display text-2xl font-bold">
                    Choose a plan to start earning
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                    Pick a plan and submit your deposit. Payments are reviewed manually before
                    activation.
                  </p>
                </div>
                <Link
                  to="/"
                  hash="pricing"
                  className="inline-flex items-center justify-center rounded-lg bg-brand px-6 py-3 font-display font-bold text-primary-foreground shadow-glow transition-transform hover:scale-105"
                >
                  Browse plans
                </Link>
              </div>
            </section>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <section className="rounded-2xl border bg-card p-5">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Deposit status
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  After you submit a transaction hash, it stays pending until an admin confirms it
                  on-chain.
                </p>
              </section>
              <section className="rounded-2xl border bg-card p-5">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">
                  Need help?
                </p>
                <p className="mt-3 text-sm text-muted-foreground">
                  Reach out through the support links in the footer if your deposit takes longer
                  than usual.
                </p>
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
