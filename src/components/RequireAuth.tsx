import { useEffect, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/components/AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || user) return;
    navigate({
      to: "/login",
      search: { redirect: `${location.pathname}${location.searchStr}` },
      replace: true,
    });
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
