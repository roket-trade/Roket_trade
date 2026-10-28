import { useEffect, type ReactNode } from "react";

import { initOneSignal } from "@/lib/onesignal";

/**
 * Boots the OneSignal web SDK exactly once, in the browser only.
 *
 * The init call lives in an effect because TanStack Start server-renders the
 * root route: touching `window`, the service worker registry or the SDK's
 * deferred queue during SSR would throw. Mounting this provider below
 * AuthProvider means the identity sync there always runs after init has started
 * (it awaits the same memoised promise), so a returning user is linked on the
 * first render tick rather than on the next navigation.
 */
export function OneSignalProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void initOneSignal();
  }, []);

  return <>{children}</>;
}
