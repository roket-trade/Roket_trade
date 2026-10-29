/**
 * Helpers for the guarded routes' "log the user in first" bounce.
 *
 * The guards used to append the current path as `?redirect=` unconditionally.
 * When one of them ran while the browser was already on `/login`, that value was
 * itself a `/login` URL, so the login page redirected to `/login?redirect=…`
 * again and the address bar grew a nested chain:
 *
 *   /login?redirect=%2Flogin%3Fredirect%3D%252Flogin…
 *
 * These helpers keep the redirect a single, plain path: nothing is appended on
 * `/login` (there is nowhere to come back to), and a `/login` value is never
 * forwarded.
 */

/** True when a pathname is the login page (including nested/decorated forms). */
export function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/") || pathname.startsWith("/login?");
}

/**
 * Search params for a redirect to `/login`.
 *
 * Returns `{}` when the caller is already on `/login` — the caller must then not
 * navigate at all, otherwise the guard re-runs forever on the same URL.
 */
export function loginRedirectSearch(pathname: string, searchStr: string): { redirect?: string } {
  if (isLoginPath(pathname)) return {};
  // Drop any `redirect` already in the query: forwarding it can carry a /login
  // URL forward (the "nested" loop) and it is meaningless as a landing page.
  const params = new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr);
  params.delete("redirect");
  const query = params.toString();
  const current = query ? `${pathname}?${query}` : pathname;
  if (isLoginPath(current)) return {};
  return { redirect: current };
}
