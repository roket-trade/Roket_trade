# send-email

Supabase Edge Function that delivers a fully rendered email through the
**Resend** API.

```
supabase/functions/send-email/index.ts
supabase/functions/_shared/email-templates.ts   # dark layout + templates
```

## Request

`POST /functions/v1/send-email`

```json
{
  "to": "user@example.com",
  "subject": "Withdrawal approved — $50.00 is on its way",
  "html": "<!doctype html>…"
}
```

| Field      | Required | Notes                                                   |
| ---------- | -------- | ------------------------------------------------------- |
| `to`       | yes      | One address, or up to 5 in an array                     |
| `subject`  | yes      | Max 200 characters                                      |
| `html`     | yes      | Max 200 KB; render it with `_shared/email-templates.ts` |
| `from`     | no       | Defaults to `EMAIL_FROM`, then `onboarding@resend.dev`  |
| `reply_to` | no       | Defaults to `EMAIL_REPLY_TO`, then the `from` address   |

Response: `{ "ok": true, "id": "<resend-message-id>" }` on success, or
`{ "ok": false, "error": "…" }` with a 4xx/5xx status.

## Authorization

`verify_jwt` is **off** at the gateway because newer Supabase secret keys are
opaque strings rather than bearer JWTs; the function authenticates every call
itself and is therefore never an open relay:

- `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — server-to-server callers
  such as `verify-crypto-deposit`.
- A signed-in **admin**'s access token — the admin panel's withdrawal notices
  (`supabase.functions.invoke("send-email", …)` forwards the session token).

Everyone else gets `401 Unauthorized`, including callers holding only the public
anon/publishable key.

## Secrets

```bash
supabase secrets set RESEND_API_KEY=re_xxxxxxxx
```

Optional:

```bash
supabase secrets set \
  EMAIL_FROM="Roket <no-reply@yourdomain.com>" \
  EMAIL_REPLY_TO=support@yourdomain.com
```

`onboarding@resend.dev` is Resend's test sender: it only delivers to the address
that owns the Resend account. Verify a domain in Resend and set `EMAIL_FROM`
before mailing real users.

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
