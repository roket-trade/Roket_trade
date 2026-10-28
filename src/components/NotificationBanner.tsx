import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, Check, Loader2, X } from "lucide-react";

import {
  getPushPermission,
  isPushPermissionDenied,
  isPushPermissionGranted,
  requestPushPermission,
} from "@/lib/onesignal";

/** Remembered so a dismissal survives reloads instead of nagging every visit. */
const DISMISSED_KEY = "roket:push-banner-dismissed";

type BannerState = "hidden" | "asking" | "enabled";

/**
 * Asks the signed-in user to enable web push. Sits on the dashboard because a
 * push subscription is only useful once an account exists (deposits and
 * withdrawals are per-user).
 *
 * The banner hides itself when there is nothing left to ask:
 *  - permission already granted → nothing to do
 *  - permission denied          → browsers ignore re-prompts, so a dead button
 *                                 would just confuse people
 *  - previously dismissed       → respect the choice
 */
export function NotificationBanner() {
  const [state, setState] = useState<BannerState>("hidden");
  const [requesting, setRequesting] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Permission can only be read in the browser, never during SSR.
    if (typeof window === "undefined") return;
    if (getPushPermission() === "unsupported") return;
    if (isPushPermissionGranted() || isPushPermissionDenied()) return;

    try {
      if (window.localStorage.getItem(DISMISSED_KEY) === "1") return;
    } catch {
      // Storage can throw in private mode; showing the banner is still fine.
    }

    setState("asking");

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  const handleAllow = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    const granted = await requestPushPermission();
    setRequesting(false);

    if (!granted) {
      // The user said no (or the browser refused). Don't keep asking.
      setState("hidden");
      return;
    }

    setState("enabled");
    hideTimer.current = setTimeout(() => setState("hidden"), 4000);
  }, [requesting]);

  const handleDismiss = useCallback(() => {
    setState("hidden");
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Non-fatal: the banner is simply allowed to return next visit.
    }
  }, []);

  if (state === "hidden") return null;

  if (state === "enabled") {
    return (
      <div
        role="status"
        className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
          <Check className="h-4 w-4" />
        </span>
        <p className="font-medium">
          Push notifications are on. You'll hear from us the moment money moves.
        </p>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="Enable push notifications"
      className="relative mt-6 overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-gray-900/60 to-gray-900/80 p-4 shadow-lg shadow-primary/5 sm:p-5"
    >
      {/* Soft glow in the corner so the card reads as an invitation, not an alert. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-primary/20 blur-2xl"
      />

      <div className="relative flex items-start gap-3 sm:gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary ring-1 ring-primary/30">
          <BellRing className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="font-display text-sm font-semibold text-foreground sm:text-base">
            Enable push notifications
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground sm:text-sm">
            Enable push notifications to get instant updates on your deposits and withdrawals.
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleAllow()}
              disabled={requesting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70 sm:text-sm"
            >
              {requesting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Enabling…
                </>
              ) : (
                "Allow"
              )}
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              disabled={requesting}
              className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60 sm:text-sm"
            >
              Not now
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss notification prompt"
          className="-mr-1 -mt-1 shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
