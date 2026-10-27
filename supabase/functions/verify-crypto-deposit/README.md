# verify-crypto-deposit

Supabase Edge Function that verifies a crypto deposit on-chain using **free public RPCs**
and activates the buyer's plan. No paid indexer, no third-party API key.

```
supabase/functions/verify-crypto-deposit/index.ts
```

## What it verifies

| Network | RPC (default)                         | Checks                                                                                                                                                                           |
| ------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BEP20` | `https://bsc-dataseed.binance.org/`   | `eth_getTransactionReceipt` succeeds, the receipt contains a BEP20 `Transfer` of the configured stablecoin **to the platform wallet**, and the amount is at least the plan price |
| `SOL`   | `https://api.mainnet-beta.solana.com` | `getTransaction` succeeds, and the platform wallet's SPL token balance delta is at least the plan price (or native SOL lamports when `SOL_TOKEN_MINT=native`)                    |

Amounts are 1:1 with USD (USDT/USDC-style stablecoins), which matches the
checkout's “send exactly $60” instruction. BEP20 defaults to **USDT on BSC**
(18 decimals); Solana defaults to **USDT SPL** (6 decimals). Overpayment is
accepted, underpayment is rejected.

## Request

`POST /functions/v1/verify-crypto-deposit`

Headers: `Authorization: Bearer <VERIFY_DEPOSIT_SECRET>` (or `x-cron-secret`).

```json
{
  "tx_hash": "0x…",
  "network": "BEP20",
  "plan_id": "3",
  "user_id": "uuid",
  "transaction_id": "uuid"
}
```

`tx_hash` is required. The transaction row in `public.transactions` is the source of
truth for amount / network / user; `plan_id` and `user_id` are fallbacks only, so a
caller cannot underpay while claiming a cheaper plan.

## Response

```json
{ "ok": true, "status": "completed", "tx_hash": "0x…", "received": "60 USDT", "expected": "60 USDT" }
{ "ok": true, "status": "pending",   "reason": "Transaction is not mined yet" }
{ "ok": true, "status": "rejected",  "reason": "Underpaid: received 12 USDT, expected 60" }
```

- `completed` — deposit flipped to `completed`; `profiles.plan_name`,
  `plan_started_at` and `plan_expires_at` (now + 365 days) were set. The
  response also carries `referral`, e.g. `{"awarded": true, "bonus": 6}` for the
  referrer's 10% bonus (see below), and `email`, e.g.
  `{"sent": true, "id": "<resend-id>"}` for the depositor's receipt (see
  [Deposit receipt email](#deposit-receipt-email)).
- `pending` (HTTP 200) — well-formed hash, not mined/confirmed yet. The pg_cron
  job retries it on the next tick (bounded by `verification_attempts`).
- `rejected` (HTTP 200) — definitive mismatch **or** an unusable hash / RPC
  error; `transactions.rejection_reason` explains why.

Malformed hashes are rejected before any RPC call (e.g. `trefdhdt564uf6ifhr7895`
on BEP20, which previously caused a node error and a 502). A thrown RPC error is
also caught, stored as `rejection_reason = 'Invalid transaction hash or
transaction not found'`, and returned as HTTP 200 so the cron poller stops
retrying that hash. Only server configuration faults reply `pending` and retry.

## Referral bonus

A completed deposit pays the referrer their 10% MLM bonus. The work happens in
`public.process_referral_bonus(deposit_tx_id)` (see
`supabase/migrations/20261025000000_process_referral_bonus.sql`) so the balance
credit and the `referral_bonus` transaction are committed atomically and at most
once per deposit. The function only needs the deposit id:

```ts
const { data, error } = await admin.rpc("process_referral_bonus", {
  p_deposit_tx_id: row.id,
});
// data = { awarded: true, bonus: 6, referrer_id, transaction_id, ... }
//      | { awarded: false, reason: "no_referrer" | "referrer_not_found" | "already_awarded" | ... }
```

The bonus never affects the deposit: missing referrer profiles, self-referrals,
legacy short-code `referred_by` values and a missing RPC are logged and reported
in `referral`, while the deposit still stays `completed`.

## Deposit receipt email

Once the deposit is `completed` **and** `profiles.plan_name` has been updated, the
function calls the [`send-email`](../send-email/README.md) Edge Function with the
service-role key to mail the depositor their receipt (dark layout, neon-green
success accent, amount, plan and expiry).

- The address comes from `auth.users` via `admin.auth.admin.getUserById()` —
  `profiles` has no email column.
- Delivery is best effort: a missing `RESEND_API_KEY`, an unverified Resend
  sender or an account without an email is logged and reported in the response's
  `email` field (`{ "sent": false, "reason": "missing_email" }`), and never
  fails or retries the verification.

## Deploy

```bash
supabase functions deploy verify-crypto-deposit --no-verify-jwt
```

`--no-verify-jwt` is used because pg_cron calls the function with a shared secret
rather than a user JWT. The function still rejects unauthenticated calls.

## Secrets

```bash
supabase secrets set \
  PLATFORM_WALLET_BEP20=0x35aec7E35F65ea227e49fDd321709D52Ada389E4 \
  PLATFORM_WALLET_SOL=3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ \
  VERIFY_DEPOSIT_SECRET="$(openssl rand -hex 32)"
```

Optional overrides:

```bash
supabase secrets set \
  BSC_RPC_URL=https://bsc-dataseed.binance.org/ \
  SOLANA_RPC_URL=https://api.mainnet-beta.solana.com \
  BEP20_TOKEN_CONTRACT=0x55d398326f99059fF775485246999027B3197955 \
  BEP20_TOKEN_DECIMALS=18 \
  BEP20_TOKEN_SYMBOL=USDT \
  SOL_TOKEN_MINT=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB \
  SOL_TOKEN_DECIMALS=6 \
  SOL_TOKEN_SYMBOL=USDT
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.

## Manual test

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/verify-crypto-deposit" \
  -H "Authorization: Bearer $VERIFY_DEPOSIT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"tx_hash":"<hash>","network":"BEP20"}'
```

The 30-second poller is installed by
`supabase/migrations/20261023000000_crypto_deposit_verification.sql`.
