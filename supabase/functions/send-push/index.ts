// Supabase Edge Function — send-push
//
// Sends a web-push notification to one user through the OneSignal REST API.
// The recipient is addressed by the OneSignal *external id*, which the browser
// SDK sets to the Supabase user id when a user signs in (see
// src/lib/onesignal.ts → syncOneSignalUser).
//
// Callers:
//   1. The admin panel (admin.tsx) after approving/rejecting a withdrawal,
//      invoking with the signed-in admin's JWT.
//   2. Other Edge Functions (verify-crypto-deposit) after a deposit is
//      confirmed, invoking with the service role key.
//
// Deploy:
//   supabase functions deploy send-push --no-verify-jwt
//
// `--no-verify-jwt` is deliberate: the deposit verifier authenticates with the
// service role key, which is not always a JWT (new sb_secret_… keys fail the
// gateway's JWT check). Authorization is enforced below instead — a service
// role bearer is trusted, any other bearer must belong to an admin profile.
//
// Required secret (supabase secrets set …):
//   ONESIGNAL_REST_API_KEY   OneSignal dashboard → Settings → Keys & IDs
// Optional secrets:
//   ONESIGNAL_APP_ID         defaults to the app id baked into the frontend
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";

const ONESIGNAL_API_URL =
  Deno.env.get("ONESIGNAL_API_URL") ?? "https://api.onesignal.com/notifications";
const DEFAULT_ONESIGNAL_APP_ID = "2211a014-e833-4ec6-a9b5-c9de8c0f50de";

/** OneSignal rejects oversized payloads; clamp before spending a request. */
const MAX_TITLE_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 600;

type SendPushRequest = {
  external_user_id?: string;
  /** A single OneSignal subscription ("player") id. */
  subscription_id?: string;
  /** Every device to notify; preferred over the external id. */
  subscription_ids?: string[];
  title?: string;
  message?: string;
};

/** OneSignal accepts a bounded include list; de-duplicate and cap it. */
function normalizeSubscriptionIds(body: SendPushRequest): string[] {
  const raw = [
    ...(Array.isArray(body.subscription_ids) ? body.subscription_ids : []),
    ...(body.subscription_id ? [body.subscription_id] : []),
  ];
  const unique = new Set<string>();
  for (const value of raw) {
    const id = String(value ?? "").trim();
    if (id) unique.add(id);
    if (unique.size >= 20) break;
  }
  return [...unique];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? "";
}

/**
 * A caller presenting the service role key is another Edge Function and has
 * already established that the action is legitimate.
 */
function isServiceCaller(token: string, serviceKey: string): boolean {
  return Boolean(serviceKey) && token.length === serviceKey.length && token === serviceKey;
}

/**
 * Anyone else must be a signed-in admin: the panel invokes this function from
 * the browser, so a plain authenticated user could otherwise craft arbitrary
 * pushes to any account.
 */
async function isAdminCaller(
  token: string,
  supabaseUrl: string,
  serviceKey: string,
): Promise<boolean> {
  if (!token) return false;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) return false;

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[send-push] could not read the caller profile", {
      code: profileError.code,
      message: profileError.message,
    });
    return false;
  }

  return profile?.is_admin === true;
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const restApiKey = Deno.env.get("ONESIGNAL_REST_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!restApiKey) {
    console.error("[send-push] ONESIGNAL_REST_API_KEY is not set");
    return json({ ok: false, error: "Server is missing ONESIGNAL_REST_API_KEY" }, 500);
  }
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Supabase credentials are not configured" }, 500);
  }

  const token = bearerToken(request);
  if (!token) return json({ ok: false, error: "Unauthorized" }, 401);

  const trusted = isServiceCaller(token, serviceKey);
  if (!trusted && !(await isAdminCaller(token, supabaseUrl, serviceKey))) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: SendPushRequest;
  try {
    body = (await request.json()) as SendPushRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const externalUserId = String(body.external_user_id ?? "").trim();
  const title = String(body.title ?? "")
    .trim()
    .slice(0, MAX_TITLE_LENGTH);
  const message = String(body.message ?? "")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);

  let subscriptionIds = normalizeSubscriptionIds(body);

  if (!externalUserId && subscriptionIds.length === 0) {
    return json(
      { ok: false, error: "subscription_id, subscription_ids or external_user_id is required" },
      400,
    );
  }
  if (!title) return json({ ok: false, error: "title is required" }, 400);
  if (!message) return json({ ok: false, error: "message is required" }, 400);

  // Given only a user id, resolve that user's devices from the table the
  // browser writes to. Targeting a subscription does not depend on
  // OneSignal.login() having attached the alias — which is the failure that
  // answers `recipients: 0`.
  if (subscriptionIds.length === 0 && externalUserId) {
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin
      .from("push_subscriptions")
      .select("subscription_id")
      .eq("user_id", externalUserId)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (error) {
      // A missing table (migration not run) must fall through to the alias path.
      console.warn("[send-push] could not read push_subscriptions:", error.message);
    } else {
      subscriptionIds = ((data ?? []) as Array<{ subscription_id: string }>)
        .map((row) => row.subscription_id)
        .filter(Boolean);
    }

    console.log("[send-push] resolved devices for user", {
      externalUserId,
      subscriptionIds,
    });
  }

  const appId = Deno.env.get("ONESIGNAL_APP_ID") ?? DEFAULT_ONESIGNAL_APP_ID;

  // Preferred: target the subscription itself. `target_channel` is only required
  // when targeting by alias, so it is omitted here.
  // Fallback: the external id alias, for accounts with no saved subscription.
  const include =
    subscriptionIds.length > 0
      ? { include_subscription_ids: subscriptionIds }
      : { include_aliases: { external_id: [externalUserId] }, target_channel: "push" as const };
  const target = subscriptionIds.length > 0 ? "subscription_ids" : "external_id";

  const payload = {
    app_id: appId,
    ...include,
    headings: { en: title },
    contents: { en: message },
  };

  console.log("[send-push] sending", { target, subscriptionIds });

  let response: Response;
  try {
    response = await fetch(ONESIGNAL_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${restApiKey}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("[send-push] OneSignal request failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return json({ ok: false, error: "Could not reach OneSignal" }, 502);
  }

  const raw = await response.text();
  let result: any = null;
  try {
    result = raw ? JSON.parse(raw) : null;
  } catch {
    // Non-JSON reply (e.g. a proxy error page); it is logged below.
    result = null;
  }

  if (!response.ok) {
    console.error("[send-push] OneSignal rejected the notification", {
      status: response.status,
      body: raw.slice(0, 500),
      externalUserId,
    });
    return json(
      {
        ok: false,
        error: "OneSignal rejected the notification",
        status: response.status,
        details: result ?? raw.slice(0, 500),
      },
      502,
    );
  }

  // A 200 with zero recipients means nothing was targeted: the API accepted the
  // call, there was simply no matching subscription. The `errors` array
  // OneSignal returns in that case says why, so it is logged and echoed back.
  const notificationId = typeof result?.id === "string" ? result.id : "";
  const recipients = Number(result?.recipients ?? 0);
  const errors = result?.errors ?? null;

  console.log("[send-push] OneSignal response", {
    id: notificationId,
    recipients,
    errors,
    target,
    externalUserId,
    subscriptionIds,
  });

  if (recipients === 0) {
    console.warn("[send-push] nobody to notify: no subscription matched", {
      target,
      externalUserId,
      subscriptionIds,
      errors,
    });
  }

  return json({ ok: true, id: notificationId || null, recipients, errors, target }, 200);
}

Deno.serve(handle);
