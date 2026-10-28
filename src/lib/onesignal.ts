import OneSignal from "react-onesignal";

/**
 * Public OneSignal web-push app id. This is not a secret — it ships inside the
 * browser bundle and identifies the app to the SDK. The REST API key that can
 * *send* notifications must never live here (server-side only).
 */
export const ONESIGNAL_APP_ID = "2211a014-e833-4ec6-a9b5-c9de8c0f50de";

/**
 * The SDK's worker is served from public/onesignal/OneSignalSDKWorker.js, so it
 * is registered on the "/onesignal/" scope rather than "/". That keeps it clear
 * of the PWA worker that vite-plugin-pwa generates at /sw.js (scope "/") — two
 * service workers cannot share one scope.
 */
export const ONESIGNAL_SERVICE_WORKER_PATH = "/onesignal/OneSignalSDKWorker.js";
export const ONESIGNAL_SERVICE_WORKER_SCOPE = "/onesignal/";

/**
 * OneSignal is browser-only: it touches `window`, `document`, `navigator` and
 * the service worker registry. Every entry point below no-ops during SSR so the
 * server render stays pure.
 */
function canUseOneSignal(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

/**
 * Single in-flight init. The SDK rejects a second `init()` call ("OneSignal is
 * already initialized"), so the promise is memoised and the identity helpers
 * await it before touching the user namespace.
 */
let initPromise: Promise<void> | null = null;

export function initOneSignal(): Promise<void> {
  if (!canUseOneSignal()) return Promise.resolve();
  if (initPromise) return initPromise;

  initPromise = OneSignal.init({
    appId: ONESIGNAL_APP_ID,
    serviceWorkerParam: { scope: ONESIGNAL_SERVICE_WORKER_SCOPE },
    serviceWorkerPath: ONESIGNAL_SERVICE_WORKER_PATH,
    allowLocalhostAsSecureOrigin: true,
  }).catch((error: unknown) => {
    // An unsupported browser, a blocked worker, or an offline CDN must never
    // take the app shell down with it.
    console.warn("[OneSignal] initialization skipped:", error);
  });

  return initPromise;
}

/**
 * The Supabase user id doubles as the OneSignal external id, so a push can be
 * addressed to a specific account with `include_aliases: { external_id: [...] }`
 * from the server.
 */
let linkedUserId: string | null = null;

async function linkUser(userId: string): Promise<void> {
  try {
    await initOneSignal();
    await OneSignal.login(userId);
    linkedUserId = userId;

    // `login()` can resolve before the alias is attached, and a subscription
    // without the alias is invisible to include_aliases targeting on the
    // server. Logging the SDK's own view makes an unlinked device obvious.
    const externalId = OneSignal.User?.externalId;
    const subscription = OneSignal.User?.PushSubscription;
    console.log("[OneSignal] linked user", {
      expectedExternalId: userId,
      externalId: externalId ?? null,
      pushSubscriptionId: subscription?.id ?? null,
      optedIn: subscription?.optedIn ?? null,
    });
    if (externalId !== userId) {
      console.warn(
        "[OneSignal] external id not attached yet — pushes addressed to this user will reach 0 devices until it is",
        { expected: userId, actual: externalId ?? null },
      );
    }
  } catch (error) {
    console.warn("[OneSignal] could not link the signed-in user:", error);
  }
}

async function unlinkUser(): Promise<void> {
  try {
    await OneSignal.logout();
  } catch (error) {
    console.warn("[OneSignal] could not unlink the user:", error);
  } finally {
    linkedUserId = null;
  }
}

/**
 * Keeps the OneSignal identity in sync with the Supabase session. Called from
 * AuthProvider whenever the session changes:
 *
 * - signed in            → `OneSignal.login(user.id)`
 * - signed out           → `OneSignal.logout()`
 * - same user again      → no-op, so re-renders don't spam the SDK
 * - anonymous on load    → no-op, so a first-time visitor isn't logged out of a
 *                          subscription that was never created
 */
export async function syncOneSignalUser(userId: string | null): Promise<void> {
  if (!canUseOneSignal()) return;

  if (userId) {
    if (linkedUserId === userId) return;
    await linkUser(userId);
    return;
  }

  if (linkedUserId) await unlinkUser();
}

export type PushPermissionState = NotificationPermission | "unsupported";

/**
 * Reads the browser's notification permission. `Notification.permission` is the
 * authoritative value for web push and, unlike the SDK's mirror, is already
 * correct before the OneSignal script finishes loading.
 */
export function getPushPermission(): PushPermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  return Notification.permission;
}

export function isPushPermissionGranted(): boolean {
  return getPushPermission() === "granted";
}

/**
 * `denied` is terminal in every major browser: re-prompting is ignored, so the
 * UI should stop asking instead of showing a button that does nothing.
 */
export function isPushPermissionDenied(): boolean {
  return getPushPermission() === "denied";
}

/**
 * Shows the native permission prompt. Resolves to whether push ended up
 * enabled; any SDK failure is treated as "not granted" rather than thrown, so
 * the caller can simply hide the banner.
 */
export async function requestPushPermission(): Promise<boolean> {
  if (!canUseOneSignal()) return false;

  await initOneSignal();

  try {
    return await OneSignal.Notifications.requestPermission();
  } catch (error) {
    console.warn("[OneSignal] permission request failed:", error);
    return false;
  }
}
