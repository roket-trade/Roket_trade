import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/components/AuthProvider";
import { supabase } from "@/integrations/supabase/client";

export function RequireAdmin({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const { user, loading: authLoading } = useAuth();
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate({
        to: "/login",
        search: { redirect: `${location.pathname}${location.searchStr}` },
        replace: true,
      });
      return;
    }
    let active = true;
    const check = async () => {
      // Tolerate DBs where the is_admin migration has not run yet.
      const { data, error } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (!active) return;
      if (error) {
        // Missing column -> treat as non-admin and send to dashboard.
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      const isAdmin = (data as { is_admin?: boolean } | null)?.is_admin === true;
      if (!active) return;
      if (!isAdmin) {
        navigate({ to: "/dashboard", replace: true });
        return;
      }
      setAllowed(true);
      setChecking(false);
    };
    void check();
    return () => {
      active = false;
    };
  }, [authLoading, user, location.pathname, location.searchStr, navigate]);

  if (authLoading || checking || !allowed) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <img src="/logo.png" alt="Roket" className="h-10" />
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Verifying admin access…</p>
      </div>
    );
  }

  return <>{children}</>;
}
