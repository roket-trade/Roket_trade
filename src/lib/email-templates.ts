// Shared, dependency-free email templates.
//
// This is the client-side copy: the admin panel renders withdrawal notices with
// it and src/test/email-templates.test.ts covers the markup.
//
// The Edge Functions are pasted into the Supabase Dashboard editor, which cannot
// bundle sibling folders, so `verify-crypto-deposit/index.ts` carries its own
// inline copy of the deposit templates. Keep the two in sync when changing the
// layout.
//
// Inline styles only: mail clients strip <style> blocks, and Resend delivers the
// HTML verbatim. Everything is a table so Outlook/Gmail render the same box.

export const NEON_GREEN = "#39ff14";
export const DANGER_RED = "#ff5a72";

const BRAND = "Roket";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const PAGE_BG = "#080b0a";
const CARD_BG = "#0f1412";
const PANEL_BG = "#111917";
const BORDER = "#1f2a24";
const TEXT = "#f4fff8";
const MUTED = "#9fb3a8";
const FAINT = "#6b8074";

/** Escapes user/DB supplied text before it is interpolated into the markup. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailRow = {
  label: string;
  value: string;
  /** Renders the value in the accent colour (amounts, success states). */
  accent?: boolean;
  /** Overrides the accent colour for this row (e.g. red on a rejection). */
  color?: string;
};

export type EmailShellOptions = {
  heading: string;
  intro: string;
  rows?: EmailRow[];
  /** Optional sentence shown below the detail panel. */
  note?: string;
  /** Optional small print above the sign-off. */
  footer?: string;
  accent?: string;
};

/** Dark, single-column layout shared by every Roket notification. */
export function emailShell({
  heading,
  intro,
  rows = [],
  note,
  footer,
  accent = NEON_GREEN,
}: EmailShellOptions): string {
  const rowsHtml = rows
    .map((row, index) => {
      const border = index === 0 ? "0" : `1px solid ${BORDER}`;
      const padding = index === 0 ? "14px" : "10px";
      const valueColor = row.accent ? (row.color ?? accent) : TEXT;
      return `
              <tr>
                <td style="padding:${padding} 16px;border-top:${border};font-size:13px;line-height:1.5;color:${MUTED};white-space:nowrap;vertical-align:top;">${escapeHtml(
                  row.label,
                )}</td>
                <td align="right" style="padding:${padding} 16px;border-top:${border};font-size:14px;line-height:1.5;font-weight:600;color:${valueColor};vertical-align:top;word-break:break-word;">${escapeHtml(
                  row.value,
                )}</td>
              </tr>`;
    })
    .join("");

  const detailPanel =
    rows.length > 0
      ? `
            <tr>
              <td style="padding:0 32px 8px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PANEL_BG};border:1px solid ${BORDER};border-radius:12px;">
                  ${rowsHtml}
                </table>
              </td>
            </tr>`
      : "";

  const noteHtml = note
    ? `
            <tr>
              <td style="padding:8px 32px 0;">
                <p style="margin:0;font-size:14px;line-height:1.6;color:${MUTED};">${escapeHtml(note)}</p>
              </td>
            </tr>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <meta name="supported-color-schemes" content="dark" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${PAGE_BG};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD_BG};border:1px solid ${BORDER};border-radius:16px;font-family:${FONT};">
            <tr>
              <td style="padding:28px 32px 0;">
                <span style="display:inline-block;font-size:12px;letter-spacing:0.28em;text-transform:uppercase;font-weight:700;color:${accent};">${BRAND}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 32px 0;">
                <h1 style="margin:0;font-size:23px;line-height:1.3;font-weight:700;color:${TEXT};">${escapeHtml(
                  heading,
                )}</h1>
                <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:${MUTED};">${escapeHtml(
                  intro,
                )}</p>
              </td>
            </tr>
            <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>${detailPanel}${noteHtml}
            <tr><td style="height:24px;line-height:24px;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:0 32px 28px;border-top:1px solid ${BORDER};">
                <p style="margin:16px 0 0;font-size:12px;line-height:1.6;color:${FAINT};">
                  ${footer ?? "You are receiving this email because you have a Roket account."}
                </p>
                <p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:${FAINT};">
                  Need help? Reply to this email and our team will take it from there.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export type WithdrawalEmailInput = {
  /** Already formatted for display, e.g. "$50.00". */
  amount: string;
  status: "completed" | "rejected";
  walletAddress?: string | null;
  /** Reason an admin rejected the request, when there is one. */
  reason?: string | null;
};

export function withdrawalEmailSubject(
  input: Pick<WithdrawalEmailInput, "amount" | "status">,
): string {
  return input.status === "completed"
    ? `Withdrawal approved — ${input.amount} is on its way`
    : `Withdrawal rejected — ${input.amount} refunded`;
}

export function withdrawalEmailHtml(input: WithdrawalEmailInput): string {
  const approved = input.status === "completed";
  const rows: EmailRow[] = [
    { label: "Amount", value: input.amount, accent: true },
    {
      label: "Status",
      value: approved ? "Approved" : "Rejected",
      accent: true,
      color: approved ? NEON_GREEN : DANGER_RED,
    },
  ];
  if (input.walletAddress) rows.push({ label: "Destination", value: input.walletAddress });
  if (!approved && input.reason) rows.push({ label: "Reason", value: input.reason });

  return emailShell({
    accent: approved ? NEON_GREEN : DANGER_RED,
    heading: approved ? "Withdrawal approved" : "Withdrawal rejected",
    intro: approved
      ? `Good news — your withdrawal of ${input.amount} has been approved and is being sent to your wallet.`
      : `Your withdrawal request for ${input.amount} was rejected. The full amount has been returned to your Roket balance.`,
    rows,
    note: approved
      ? "Once the network confirms the transfer it will appear in your wallet. Keep this email as your receipt."
      : "You can request a new withdrawal at any time from your dashboard. If you think this was a mistake, reply to this email.",
  });
}

export type DepositEmailInput = {
  /** Already formatted for display, e.g. "60 USDT". */
  amount: string;
  planName: string;
  /** ISO timestamp of the plan expiry, when known. */
  expiresAt?: string | null;
  txHash?: string | null;
};

export function depositEmailSubject(input: Pick<DepositEmailInput, "planName">): string {
  return `Deposit confirmed — ${input.planName} is now active`;
}

export function depositEmailHtml(input: DepositEmailInput): string {
  const rows: EmailRow[] = [
    { label: "Amount received", value: input.amount, accent: true },
    { label: "Plan", value: input.planName, accent: true },
  ];
  if (input.expiresAt) {
    const date = new Date(input.expiresAt);
    if (!Number.isNaN(date.getTime())) {
      rows.push({
        label: "Active until",
        value: date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        }),
      });
    }
  }
  if (input.txHash) rows.push({ label: "Transaction", value: input.txHash });

  return emailShell({
    heading: "Deposit confirmed",
    intro: `We verified your deposit on-chain. Your ${input.planName} is active and daily profits start accruing from today.`,
    rows,
    note: "Head to your dashboard to track earnings, referrals and your plan window.",
  });
}
