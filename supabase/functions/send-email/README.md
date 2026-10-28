# send-email

Supabase Edge Function that delivers a fully rendered email through the
**Resend** API.

```
supabase/functions/send-email/index.ts
src/lib/email-templates.ts   # dark layout + templates used by the app
```

This function has no local imports: it is safe to paste straight into the
Supabase Dashboard editor.

## Request

`POST /functions/v1/send-email`

```json
{
  "to": "user@example.com",
  "subject": "Withdrawal approved — $50.00 is on its way",
  "html": "<!doctype html>…"
}
```

| Field      | Required | Notes                                                               |
| ---------- | -------- | ------------------------------------------------------------------- |
| `to`       | yes      | One address, or up to 5 in an array                                 |
| `subject`  | yes      | Max 200 characters                                                  |
| `html`     | yes      | Max 200 KB; render it with `src/lib/email-templates.ts`             |
| `from`     | no       | Defaults to `EMAIL_FROM`, then `Roket Support <support@roket.bond>` |
| `reply_to` | no       | Defaults to `EMAIL_REPLY_TO`, then the `from` address               |

Response: `{ "ok": true, "id": "<resend-message-id>" }` on success, or
`{ "ok": false, "error": "…" }` with a 4xx/5xx status.

## Authorization

`verify_jwt` is **off** at the gateway (newer Supabase secret keys are opaque
strings rather than bearer JWTs), so the function performs one simple check:

- `Authorization: Bearer <token>` is **required** — a missing header returns
  `401 Unauthorized`.
- The service-role key is accepted for server-to-server callers such as
  `verify-crypto-deposit`.
- Any other token is accepted when it resolves to a signed-in Supabase user
  (`auth.getUser`). `supabase.functions.invoke("send-email", …)` sends the
  session token automatically, so the admin panel needs no extra wiring.

There is no custom shared secret and no admin/profile lookup. Because any
signed-in user can reach this function, the payload is still validated (valid
recipient, subject length, HTML size) and abuse should be monitored in the
function logs.

## Secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
```

Optional:

```bash
supabase secrets set \
  EMAIL_FROM="Roket Support <support@roket.bond>" \
  EMAIL_REPLY_TO=support@roket.bond
```

`roket.bond` is a verified sending domain in Resend, so the default sender
`Roket Support <support@roket.bond>` delivers to real users with no extra
configuration. Set `EMAIL_FROM` only if you want a different verified address
(for example `no-reply@roket.bond`); Resend rejects any sender on a domain that
is not verified in the account. `EMAIL_REPLY_TO` should stay a monitored mailbox
because user replies land there.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically.

## Deploy

```bash
supabase functions deploy send-email
```

## Callers

- `src/routes/admin.tsx` — emails the user after an admin approves or rejects a
  withdrawal (`withdrawalEmailHtml` / `withdrawalEmailSubject`). The ledger write
  happens first; a mail failure only surfaces a warning toast.
- `supabase/functions/verify-crypto-deposit/index.ts` — emails the depositor a
  receipt once the deposit is verified and the plan is active
  (`depositEmailHtml` / `depositEmailSubject`), called with the service-role key.

## Manual test

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-email" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"to":"you@example.com","subject":"Roket test","html":"<h1 style=\"color:#39ff14\">It works</h1>"}'
```
