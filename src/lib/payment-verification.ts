// Shared contract for the global crypto payment verification bar.
// Kept in lib/ so the checkout route, the provider and the bar can import it
// without a circular dependency.

export const PAYMENT_VERIFICATION_EVENT = "roket:payment-verified";

export type PaymentVerificationState = "idle" | "verifying" | "success" | "failed";

export type PaymentVerificationTarget = {
  txHash: string;
  userId?: string;
  planName?: string | null;
};

export const PAYMENT_VERIFICATION_MESSAGES: Record<
  Exclude<PaymentVerificationState, "idle">,
  string
> = {
  verifying: "Verifying payment on blockchain...",
  success: "Payment Verified! Your plan is now active.",
  failed: "Verification failed. Please contact support.",
};
