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

Headers: `Authorization: Bearer <caller token>` (see _Authorization_).

Target exactly one way — subscription ids win when both are present:

```json
{
  "subscription_ids": ["6f1e…", "9ab2…"],
  "title": "Withdrawal Update",
  "message": "Your withdrawal of $50.00 has been approved."
}
```

```json
{
  "external_user_id": "11111111-2222-3333-4444-555555555555",
  "title": "Deposit Confirmed",
  "message": "Your deposit of $60.00 has been confirmed."
}
```

`title` and `message` are required; at least one target is required. `title` is
clamped to 120 characters and `message` to 600 to stay inside OneSignal's payload
limits. `subscription_id` (singular) is also accepted.

## Targeting: subscription ids first

| Input                                    | Payload OneSignal receives                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `subscription_ids` / `subscription_id`   | `include_subscription_ids: [...]`                                            |
| `external_user_id` with saved devices    | `include_subscription_ids: [...]`, resolved from `public.push_subscriptions` |
| `external_user_id` with no saved devices | `include_aliases: { external_id: [...] }` + `target_channel: "push"`         |

Subscription ids are preferred because the alias path depends on
`OneSignal.login()` having attached the external id, and when that silently fails
OneSignal answers **200 with `recipients: 0`** — a push that looks sent but
reaches nobody. The subscription id is created by the act of subscribing, so it
does not depend on the alias at all.

The browser writes its subscription id to `public.push_subscriptions`
(`src/lib/onesignal.ts`); see
`supabase/migrations/20261107000000_push_subscriptions.sql`.

## Response

```json
{ "ok": true, "id": "0f1e…", "recipients": 1 }
{ "ok": false, "error": "OneSignal rejected the notification", "status": 401, "details": { } }
{ "ok": false, "error": "Unauthorized" }
```

`recipients: 0` with `ok: true` means the user has no push subscription yet (they
never granted permission) — the call succeeded, there was nobody to notify.

## Troubleshooting: `recipients: 0`

Nothing was targeted — the API accepted the call but no subscription matched. The
function's reply now carries `target`, which tells you which path ran:

- `target: "subscription_ids"` and still 0 → the stored id is stale (browser
  cleared site data, uninstalled the PWA, or OneSignal rotated it). Ask the user
  to open the app while signed in; the browser re-saves its current id on login
  and on every subscription change.
- `target: "external_id"` → no row in `public.push_subscriptions` for that user,
  so it fell back to the alias. That means the browser never saved a subscription
  id — usually permission was never granted on that device, or the migration has
  not been run.

Checks on the device (console), all logged by `src/lib/onesignal.ts`:

1. `[OneSignal] subscription id for this browser:` — must print a UUID. `null`
   means permission was never granted there.
2. `[OneSignal] saved subscription id for user <id> <sub id>` — confirms it
   reached the database.
3. `[OneSignal] linked user` — shows `externalId` (the alias) next to
   `expectedExternalId`. A mismatch is survivable now: pushes no longer depend
   on it.

`errors` in the response carries OneSignal's own reason, e.g.
`["All included players are not subscribed"]`.

## Authorization

Deployed with `--no-verify-jwt` because another Edge Function calls it with the
service role key, which is not always a JWT (new `sb_secret_…` keys fail the
gateway's JWT check). The function authorizes every call itself:

| Caller                                     | Accepted?                                               |
| ------------------------------------------ | ------------------------------------------------------- |
| Edge Function presenting the service role  | Yes — trusted internal caller                           |
| Signed-in user, `profiles.is_admin = true` | Yes — the admin panel's approve/reject actions          |
| Any other signed-in user                   | No — `401`. Otherwise any customer could push to anyone |
| No bearer token                            | No — `401`                                              |

## Callers

| Caller                                     | Trigger                                       |
| ------------------------------------------ | --------------------------------------------- |
| `src/routes/admin.tsx`                     | Withdrawal **approved** or **rejected**       |
| `supabase/functions/verify-crypto-deposit` | Deposit verified and committed as `completed` |

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
