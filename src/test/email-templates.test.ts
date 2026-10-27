import { describe, expect, it } from "vitest";

import {
  depositEmailHtml,
  depositEmailSubject,
  escapeHtml,
  withdrawalEmailHtml,
  withdrawalEmailSubject,
} from "@/lib/email-templates";

describe("email templates", () => {
  it("escapes markup so user supplied text cannot inject HTML", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
    expect(escapeHtml("O'Brien & Co")).toBe("O&#39;Brien &amp; Co");
  });

  it("renders the dark approved-withdrawal notice with neon-green accents", () => {
    const html = withdrawalEmailHtml({ amount: "$50.00", status: "completed" });

    expect(withdrawalEmailSubject({ amount: "$50.00", status: "completed" })).toContain(
      "Withdrawal approved",
    );
    expect(html).toContain("background:#080b0a");
    expect(html).toContain("background:#0f1412");
    expect(html).toContain("#39ff14");
    expect(html).toContain("$50.00");
    expect(html).toContain("Approved");
    expect(html).not.toContain("#ff5a72");
  });

  it("renders a rejection notice in red and explains the refund", () => {
    const html = withdrawalEmailHtml({
      amount: "$75.50",
      status: "rejected",
      walletAddress: "0xabc",
      reason: "Address failed screening",
    });

    expect(withdrawalEmailSubject({ amount: "$75.50", status: "rejected" })).toContain(
      "$75.50 refunded",
    );
    expect(html).toContain("Withdrawal rejected");
    expect(html).toContain("#ff5a72");
    expect(html).toContain("returned to your Roket balance");
    expect(html).toContain("0xabc");
    expect(html).toContain("Address failed screening");
  });

  it("renders the deposit receipt with the plan and neon-green accents", () => {
    const html = depositEmailHtml({
      amount: "60 USDT",
      planName: "Plan 1",
      expiresAt: "2027-10-27T00:00:00.000Z",
      txHash: "0xdeadbeef",
    });

    expect(depositEmailSubject({ planName: "Plan 1" })).toBe(
      "Deposit confirmed — Plan 1 is now active",
    );
    expect(html).toContain("Deposit confirmed");
    expect(html).toContain("Plan 1");
    expect(html).toContain("60 USDT");
    expect(html).toContain("Oct 27, 2027");
    expect(html).toContain("0xdeadbeef");
    expect(html).toContain("#39ff14");
  });

  it("escapes plan names before they reach the markup", () => {
    const html = depositEmailHtml({ amount: "60 USDT", planName: "<b>Plan</b>" });
    expect(html).toContain("&lt;b&gt;Plan&lt;/b&gt;");
    expect(html).not.toContain("<b>Plan</b>");
  });
});
