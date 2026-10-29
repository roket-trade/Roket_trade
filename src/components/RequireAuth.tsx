import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/components/AuthProvider";
import { loginRedirectSearch } from "@/lib/auth-redirect";

export function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || user) return;
    // Already on /login: redirecting again is what nested the param into
    // /login?redirect=%2Flogin%3Fredirect%3D…, so stay put instead.
    const search = loginRedirectSearch(location.pathname, location.searchStr);
    if (!search.redirect) return;
    navigate({ to: "/login", search, replace: true });
  }, [loading, user, location.pathname, location.searchStr, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <img src="/logo.png" alt="Roket" className="h-10" />
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }

  return <>{children}</>;
}
