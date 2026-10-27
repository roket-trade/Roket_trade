// Supabase Edge Function — send-email
//
// Thin, authenticated relay to the Resend API. Callers supply the fully rendered
// email (see supabase/functions/_shared/email-templates.ts), so this function
// owns delivery, validation and access control only.
//
//   POST /functions/v1/send-email
//   { "to": "user@example.com", "subject": "…", "html": "<!doctype html>…" }
//
// Authorization:
//   - `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — server-to-server
//     callers (verify-crypto-deposit).
//   - a signed-in admin's access token — the admin panel's withdrawal notices.
//   Anything else is rejected, so the function can never be used as an open
//   mail relay with the public anon/publishable key.
//
// Deploy:
//   supabase functions deploy send-email
//
// Required secrets (supabase secrets set ...):
//   RESEND_API_KEY   Resend API key with permission to send
// Optional secrets:
//   EMAIL_FROM       defaults to onboarding@resend.dev (Resend's test sender,
//                    which can only deliver to the account owner's address)
//   EMAIL_REPLY_TO   defaults to EMAIL_FROM
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by
// the platform.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "onboarding@resend.dev";
const MAX_RECIPIENTS = 5;
const MAX_SUBJECT_LENGTH = 200;
const MAX_HTML_BYTES = 200_000;
const REQUEST_TIMEOUT_MS = 15_000;
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;

// The admin panel calls this from the browser, so the function must answer the
// CORS preflight and echo the allow headers back. Access control is the bearer
// token check below, not the origin.
const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "access-control-max-age": "86400",
};

type SendEmailRequest = {
  to?: string | string[];
  subject?: string;
  html?: string;
  /** Optional override; falls back to EMAIL_FROM / onboarding@resend.dev. */
  from?: string;
  reply_to?: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}

function bearerToken(request: Request): string {
  return (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
}

/**
 * Service-role calls come from other Edge Functions; everything else must be a
 * signed-in user whose profile is flagged `is_admin`.
 */
async function isAuthorized(request: Request): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && token === serviceKey) return true;

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) return false;

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData?.user) return false;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[send-email] could not read caller profile", {
      userId: userData.user.id,
      code: profileError.code,
      message: profileError.message,
    });
    return false;
  }
  return profile?.is_admin === true;
}

function normalizeRecipients(value: string | string[] | undefined): string[] | null {
  const list = (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (list.length === 0 || list.length > MAX_RECIPIENTS) return null;
  return list.every((item) => EMAIL_RE.test(item)) ? list : null;
}

async function sendWithResend(payload: Record<string, unknown>, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw = await response.text();
    let parsed: any = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    return { response, parsed, raw };
  } finally {
    clearTimeout(timer);
  }
}

async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[send-email] RESEND_API_KEY is not configured");
    return json({ ok: false, error: "Email service is not configured" }, 500);
  }

  if (!(await isAuthorized(request))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: SendEmailRequest;
  try {
    body = (await request.json()) as SendEmailRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const recipients = normalizeRecipients(body.to);
  if (!recipients) {
    return json({ ok: false, error: "`to` must be a valid email address" }, 400);
  }

  const subject = String(body.subject ?? "").trim();
  if (!subject) return json({ ok: false, error: "`subject` is required" }, 400);
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return json({ ok: false, error: "`subject` is too long" }, 400);
  }

  const html = String(body.html ?? "");
  if (!html.trim()) return json({ ok: false, error: "`html` is required" }, 400);
  if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) {
    return json({ ok: false, error: "`html` is too large" }, 413);
  }

  const configuredFrom = String(Deno.env.get("EMAIL_FROM") ?? "").trim();
  const from = String(body.from ?? "").trim() || configuredFrom || DEFAULT_FROM;
  const configuredReplyTo = String(Deno.env.get("EMAIL_REPLY_TO") ?? "").trim();
  const replyTo = String(body.reply_to ?? "").trim() || configuredReplyTo || from;

  const payload: Record<string, unknown> = {
    from: from.includes("<") ? from : `Roket <${from}>`,
    to: recipients,
    subject,
    html,
  };
  if (replyTo) payload["reply_to"] = replyTo;

  let result: Awaited<ReturnType<typeof sendWithResend>>;
  try {
    result = await sendWithResend(payload, apiKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-email] Resend request failed", { message, recipients });
    return json({ ok: false, error: "Could not reach the email service" }, 502);
  }

  const { response, parsed, raw } = result;
  if (!response.ok) {
    const reason =
      (parsed && (parsed.message || parsed.error)) || raw || `Resend returned ${response.status}`;
    console.error("[send-email] Resend rejected the message", {
      status: response.status,
      reason,
      recipients,
    });
    return json({ ok: false, error: String(reason) }, response.status === 429 ? 429 : 502);
  }

  console.log("[send-email] sent", { id: parsed?.id ?? null, recipients, subject });
  return json({ ok: true, id: parsed?.id ?? null }, 200);
}

Deno.serve(handle);
