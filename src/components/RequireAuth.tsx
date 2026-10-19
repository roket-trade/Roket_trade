import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import logo from "@/assets/roket-logo.png.asset.json";
import { supabase } from "@/integrations/supabase/client";

export function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    let active = true;

    const redirectToLogin = () => {
      if (!active) return;
      navigate({
        to: "/login",
        search: { redirect: `${location.pathname}${location.searchStr}` },
        replace: true,
      });
    };

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (!data.session) {
        redirectToLogin();
        return;
      }
      setAuthenticated(true);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setAuthenticated(true);
      else redirectToLogin();
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [location.pathname, location.searchStr, navigate]);

  if (!authenticated) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <img src={logo.url} alt="Roket" className="h-10" />
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-sm text-muted-foreground">Checking your session…</p>
      </div>
    );
  }

  return <>{children}</>;
}
