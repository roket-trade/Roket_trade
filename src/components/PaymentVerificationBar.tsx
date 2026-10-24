import {
  PAYMENT_VERIFICATION_MESSAGES,
  type PaymentVerificationState,
} from "@/lib/payment-verification";

type BarState = Exclude<PaymentVerificationState, "idle">;

type BarStyle = {
  wrapper: string;
  icon: string;
  iconWrap: string;
  text: string;
  dismiss: string;
};

const STYLES: Record<BarState, BarStyle> = {
  verifying: {
    wrapper:
      "border-blue-400/30 shadow-[0_0_45px_-10px_rgba(59,130,246,0.9)] ring-1 ring-blue-400/10",
    icon: "text-blue-300",
    iconWrap: "bg-blue-500/15",
    text: "text-blue-50",
    dismiss: "text-blue-200/70 hover:bg-blue-500/15 hover:text-blue-100",
  },
  success: {
    wrapper:
      "border-emerald-400/30 shadow-[0_0_45px_-10px_rgba(16,185,129,0.9)] ring-1 ring-emerald-400/10",
    icon: "text-emerald-300",
    iconWrap: "bg-emerald-500/15",
    text: "text-emerald-50",
    dismiss: "text-emerald-200/70 hover:bg-emerald-500/15 hover:text-emerald-100",
  },
  failed: {
    wrapper:
      "border-rose-400/30 shadow-[0_0_45px_-10px_rgba(244,63,94,0.9)] ring-1 ring-rose-400/10",
    icon: "text-rose-300",
    iconWrap: "bg-rose-500/15",
    text: "text-rose-50",
    dismiss: "text-rose-200/70 hover:bg-rose-500/15 hover:text-rose-100",
  },
};

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

function Checkmark() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function Cross() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-5 w-5"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

function StatusIcon({ state }: { state: BarState }) {
  if (state === "verifying") return <Spinner />;
  if (state === "success") return <Checkmark />;
  return <Cross />;
}

type PaymentVerificationBarProps = {
  state: PaymentVerificationState;
  onDismiss?: () => void;
};

/**
 * Global payment status pill. Fixed to the bottom centre, dark glassmorphism,
 * with a coloured glow per state.
 */
export function PaymentVerificationBar({ state, onDismiss }: PaymentVerificationBarProps) {
  if (state === "idle") return null;

  const style = STYLES[state];

  return (
    <div
      role="status"
      aria-live="polite"
      data-state={state}
      data-testid="payment-verification-bar"
      className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex w-[calc(100%_-_2rem)] max-w-md items-center gap-3 rounded-2xl border bg-slate-950/80 px-4 py-3 text-sm shadow-2xl backdrop-blur-xl ${style.wrapper}`}
    >
      <span
        aria-hidden="true"
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${style.iconWrap} ${style.icon}`}
      >
        <StatusIcon state={state} />
      </span>

      <p className={`min-w-0 flex-1 font-medium leading-snug ${style.text}`}>
        {PAYMENT_VERIFICATION_MESSAGES[state]}
      </p>

      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss payment status"
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${style.dismiss}`}
        >
          <Cross />
        </button>
      ) : null}
    </div>
  );
}
