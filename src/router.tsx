import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

/**
 * TanStack Router's default search parser runs JSON.parse on values that look
 * JSON-ish. Referral codes are opaque strings that can also be valid JSON
 * numbers — "80758E76" is 80758 × 10^76 — so the default turned it into
 * 8.0758e+80 and client-side navigations rewrote the URL as
 * ?ref=8.0758e%2B80. These keep search params as plain strings end to end:
 *
 *   parseSearch("?ref=80758E76")         -> { ref: "80758E76" }
 *   stringifySearch({ ref: "80758E76" }) -> "?ref=80758E76"
 *
 * Notes:
 * - Values are decoded with URLSearchParams (same decoding as a normal query
 *   string) and are never passed through Number/parseFloat/JSON.parse.
 * - A repeated key keeps its last value, matching URLSearchParams#get.
 * - Object-valued params are not supported; they serialize via String().
 */
export const parseSearch = (searchStr: string): Record<string, string> => {
  const query = searchStr.startsWith("?") ? searchStr.slice(1) : searchStr;
  const search: Record<string, string> = {};
  if (!query) return search;
  for (const [key, value] of new URLSearchParams(query)) {
    search[key] = value;
  }
  return search;
};

/**
 * Serialize the search object back to a query string without altering values —
 * no JSON quoting, so { ref: "80758E76" } stays "?ref=80758E76".
 */
export const stringifySearch = (search: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search ?? {})) {
    if (value === undefined || value === null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) {
      if (item === undefined || item === null) continue;
      params.append(key, String(item));
    }
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
};

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    parseSearch,
    stringifySearch,
  });

  return router;
};
