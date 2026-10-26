import { Link } from "@tanstack/react-router";
import { useAuth } from "@/components/AuthProvider";

/** Neon green → cyan CTA shared by every page header (matches the dark theme). */
export const headerCtaClass =
  "inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-emerald-400 to-cyan-400 px-5 py-2 font-display text-sm font-bold text-gray-950 shadow-[0_0_18px_rgba(52,211,153,0.35)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const secondaryLinkClass =
  "rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground";

type HeaderAuthNavProps = {
  /**
   * The page this header belongs to. Drives which single primary action we
   * show: "home" → Dashboard, "dashboard" → Home, "other" → Home + Dashboard.
   */
  current: "home" | "dashboard" | "other";
};

/**
 * Context-aware header action.
 *
 * - Logged out: a single "Login / Signup" button.
 * - Logged in on "/": a single "Dashboard" button.
 * - Logged in on "/dashboard": a single "Home" button.
 * - Logged in anywhere else: "Home" plus a "Dashboard" button.
 *
 * There is deliberately no logout action in the header.
 */
export function HeaderAuthNav({ current }: HeaderAuthNavProps) {
  const { user, loading } = useAuth();

  // Avoid flashing "Login / Signup" while the session is still being restored.
  if (loading) return null;

  if (!user) {
    return (
      <nav aria-label="Account" className="flex items-center gap-2">
        <Link to="/login" className={headerCtaClass}>
          Login / Signup
        </Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Account" className="flex items-center gap-2">
      {current === "other" && (
        <Link to="/" className={secondaryLinkClass}>
          Home
        </Link>
      )}
      {current === "dashboard" ? (
        <Link to="/" className={headerCtaClass}>
          Home
        </Link>
      ) : (
        <Link to="/dashboard" className={headerCtaClass}>
          Dashboard
        </Link>
      )}
    </nav>
  );
}
