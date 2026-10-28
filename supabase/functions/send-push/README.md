# send-push

Supabase Edge Function that sends a **web-push notification to one user** through
the OneSignal REST API.

```
supabase/functions/send-push/index.ts
```

The recipient is addressed by their OneSignal **external id**, which the browser
SDK sets to the Supabase user id at sign-in (`src/lib/onesignal.ts` →
`syncOneSignalUser`), so a push only reaches the browsers that user is signed in
on.

## Request

`POST /functions/v1/send-push`

Headers: `Authorization: Bearer <caller token>` (see *Authorization*).

```json
{
  "external_user_id": "11111111-2222-3333-4444-555555555555",
  "title": "Withdrawal Update",
  "message": "Your withdrawal of $50.00 has been approved."
}
```

All three fields are required. `title` is clamped to 120 characters and
`message` to 600 to stay inside OneSignal's payload limits.

## Response

```json
{ "ok": true, "id": "0f1e…", "recipients": 1 }
{ "ok": false, "error": "OneSignal rejected the notification", "status": 401, "details": { } }
{ "ok": false, "error": "Unauthorized" }
```

`recipients: 0` with `ok: true` means the user has no push subscription yet (they
never granted permission) — the call succeeded, there was nobody to notify.

## Authorization

Deployed with `--no-verify-jwt` because another Edge Function calls it with the
service role key, which is not always a JWT (new `sb_secret_…` keys fail the
gateway's JWT check). The function authorizes every call itself:

| Caller                                     | Accepted?                                              |
| ------------------------------------------ | ------------------------------------------------------ |
| Edge Function presenting the service role  | Yes — trusted internal caller                          |
| Signed-in user, `profiles.is_admin = true` | Yes — the admin panel's approve/reject actions         |
| Any other signed-in user                   | No — `401`. Otherwise any customer could push to anyone |
| No bearer token                            | No — `401`                                             |

## Callers

| Caller                                       | Trigger                                        |
| -------------------------------------------- | ---------------------------------------------- |
| `src/routes/admin.tsx`                       | Withdrawal **approved** or **rejected**        |
| `supabase/functions/verify-crypto-deposit`   | Deposit verified and committed as `completed`  |

Both treat the push as best-effort: the money movement is already committed, so a
failed notification is logged and never retried or surfaced as an error.

## Deploy

```bash
supabase functions deploy send-push --no-verify-jwt
```

## Secrets

```bash
supabase secrets set ONESIGNAL_REST_API_KEY=<your OneSignal REST API key>
```

OneSignal dashboard → **Settings → Keys & IDs → REST API Key**. Never expose this
key to the browser: it can send notifications to the whole app. The browser only
ever sees the public app id.

Optional overrides:

```bash
supabase secrets set \
  ONESIGNAL_APP_ID=<app id>          # defaults to the app id baked into the frontend \
  ONESIGNAL_API_URL=<url>            # defaults to https://api.onesignal.com/notifications
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Manual test

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-push" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"external_user_id":"<user uuid>","title":"Test","message":"Hello from send-push"}'
```
