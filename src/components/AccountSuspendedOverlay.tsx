import { type ReactNode } from "react";

type AccountSuspendedOverlayProps = {
  isSuspended?: boolean;
  open?: boolean;
  onContactSupport?: () => void;
  onSignOut?: () => void;
  children?: ReactNode;
};

export function AccountSuspendedOverlay({
  isSuspended = false,
  open,
  onContactSupport,
  onSignOut,
}: AccountSuspendedOverlayProps) {
  const visible = open ?? isSuspended;
  if (!visible) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-suspended-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-md p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card/70 p-6 text-center shadow-2xl backdrop-blur-xl">
        <h2 id="account-suspended-title" className="font-display text-xl font-bold text-destructive">
          Account Suspended
        </h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Your account has been suspended. Please contact support.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          {onContactSupport && (
            <button
              type="button"
              onClick={onContactSupport}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Contact Support
            </button>
          )}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="rounded-lg bg-destructive px-4 py-2 text-sm font-bold text-destructive-foreground transition-opacity hover:opacity-90"
            >
              Sign out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AccountSuspendedOverlay;
