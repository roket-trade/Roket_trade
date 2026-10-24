import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentVerificationBar } from "@/components/PaymentVerificationBar";
import {
  PAYMENT_VERIFICATION_MESSAGES,
  type PaymentVerificationState,
} from "@/lib/payment-verification";

afterEach(cleanup);

describe("PaymentVerificationBar", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<PaymentVerificationBar state="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is fixed to the bottom centre with a dark glassmorphism shell", () => {
    render(<PaymentVerificationBar state="verifying" />);

    const bar = screen.getByRole("status");
    expect(bar.className).toContain("fixed bottom-4 left-1/2 z-50 -translate-x-1/2");
    expect(bar.className).toContain("bg-slate-950/80");
    expect(bar.className).toContain("backdrop-blur-xl");
    expect(bar).toHaveAttribute("aria-live", "polite");
    expect(bar).toHaveAttribute("data-state", "verifying");
  });

  it.each<[PaymentVerificationState, string, string]>([
    [
      "verifying",
      PAYMENT_VERIFICATION_MESSAGES.verifying,
      "shadow-[0_0_45px_-10px_rgba(59,130,246,0.9)]",
    ],
    [
      "success",
      PAYMENT_VERIFICATION_MESSAGES.success,
      "shadow-[0_0_45px_-10px_rgba(16,185,129,0.9)]",
    ],
    ["failed", PAYMENT_VERIFICATION_MESSAGES.failed, "shadow-[0_0_45px_-10px_rgba(244,63,94,0.9)]"],
  ])("shows the %s copy and glow", (state, message, glow) => {
    render(<PaymentVerificationBar state={state} />);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole("status").className).toContain(glow);
  });

  it("lets the user dismiss the bar", () => {
    const onDismiss = vi.fn();
    render(<PaymentVerificationBar state="failed" onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss payment status" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
