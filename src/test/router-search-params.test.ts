import { describe, expect, it } from "vitest";

import { getRouter, parseSearch, stringifySearch } from "@/router";

describe("router search param serialization", () => {
  it("keeps numeric-looking values as strings", () => {
    // Number("80758E76") === 8.0758e+80; the router must never coerce it.
    expect(parseSearch("?ref=80758E76")).toEqual({ ref: "80758E76" });
    expect(parseSearch("ref=80758E76")).toEqual({ ref: "80758E76" });
    expect(parseSearch("?page=1&active=true")).toEqual({ page: "1", active: "true" });
    expect(parseSearch("")).toEqual({});
  });

  it("serializes the search object verbatim", () => {
    expect(stringifySearch({ ref: "80758E76" })).toBe("?ref=80758E76");
    expect(stringifySearch({ ref: "80758E76", note: "a b" })).toBe("?ref=80758E76&note=a+b");
    expect(stringifySearch({})).toBe("");
    expect(stringifySearch({ ref: undefined, redirect: null })).toBe("");
  });

  it("round-trips a referral code without scientific notation", () => {
    const search = parseSearch(stringifySearch({ ref: "80758E76" }));
    expect(search.ref).toBe("80758E76");
    expect(typeof search.ref).toBe("string");
  });

  it("wires the custom parser and serializer into the app router", () => {
    const router = getRouter();

    expect(router.options.parseSearch("?ref=80758E76")).toEqual({ ref: "80758E76" });
    expect(router.options.stringifySearch({ ref: "80758E76" })).toBe("?ref=80758E76");
  });

  it("builds an in-app /signup link with the code intact", () => {
    const router = getRouter();

    const location = router.buildLocation({
      to: "/signup",
      search: { ref: "80758E76" },
    });

    expect(location.href).toBe("/signup?ref=80758E76");
  });

  it("keeps the login redirect param a plain path", () => {
    const router = getRouter();

    const location = router.buildLocation({
      to: "/login",
      search: { redirect: "/dashboard" },
    });

    expect(location.href).toBe("/login?redirect=%2Fdashboard");
    expect(parseSearch(location.searchStr)).toEqual({ redirect: "/dashboard" });
  });
});
