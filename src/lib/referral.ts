/**
 * Referral helpers.
 *
 * A referral code is an opaque string such as "80758E76". TanStack Router's
 * default search parser JSON-parses values that look like numbers, and
 * "80758E76" is a *valid JSON number* (80758 × 10^76) — it came back as
 * 8.0758e+80 and was rendered into the signup input. Everything here therefore
 * treats the code strictly as a string: no Number(), parseFloat() or JSON
 * round-trips.
 */

export const REFERRAL_SIGNUP_URL = "https://roket.bond/signup";

/**
 * Read the `ref` query parameter from a raw (unparsed) query string, e.g.
 * "?ref=80758E76". Returns "" when the parameter is missing.
 */
export function readReferralCode(searchStr: string | null | undefined): string {
  if (!searchStr) return "";
  const query = searchStr.startsWith("?") ? searchStr : `?${searchStr}`;
  try {
    const searchParams = new URLSearchParams(query);
    return String(searchParams.get("ref") || "").trim();
  } catch {
    return "";
  }
}

/** Build the shareable signup link for a referral code. */
export function buildReferralLink(code: string | null | undefined): string {
  const clean = String(code ?? "").trim();
  return clean ? `${REFERRAL_SIGNUP_URL}?ref=${encodeURIComponent(clean)}` : "";
}
