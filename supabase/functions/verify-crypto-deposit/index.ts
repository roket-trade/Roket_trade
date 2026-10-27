// Supabase Edge Function — verify-crypto-deposit
//
// Verifies a crypto deposit against free public RPCs (no paid indexer):
//   - BEP20: BNB Smart Chain `eth_getTransactionReceipt` + BEP20 Transfer logs
//   - SOL:   Solana `getTransaction` (SPL token balance delta, or native SOL)
//
// On success it marks the deposit `completed` and activates the user's plan.
// On a definitive on-chain mismatch, a malformed hash, or an RPC error it marks
// the deposit `rejected` with a reason and returns HTTP 200 so the cron poller
// does not retry the same bad hash.
// If the transaction is valid but not mined/confirmed yet it leaves the deposit
// `pending` so the 30-second pg_cron poller retries it (bounded by
// verification_attempts).
//
// Deploy:
//   supabase functions deploy verify-crypto-deposit --no-verify-jwt
//
// Required secrets (supabase secrets set ...):
//   PLATFORM_WALLET_BEP20   e.g. 0x35aec7E35F65ea227e49fDd321709D52Ada389E4
//   PLATFORM_WALLET_SOL     e.g. 3mjR2gV3MJrudjus9yBuh3EtSMw6Ca5BVFcYiMDa1VjQ
//   VERIFY_DEPOSIT_SECRET   shared secret also stored in Supabase Vault for cron
// Optional secrets:
//   BSC_RPC_URL (default https://bsc-dataseed.binance.org/)
//   SOLANA_RPC_URL (default https://api.mainnet-beta.solana.com)
//   BEP20_TOKEN_CONTRACT / BEP20_TOKEN_DECIMALS / BEP20_TOKEN_SYMBOL
//   SOL_TOKEN_MINT / SOL_TOKEN_DECIMALS ("native" verifies plain SOL)
//   SOL_USD_PRICE (only needed when SOL_TOKEN_MINT=native)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { depositEmailHtml, depositEmailSubject } from "../_shared/email-templates.ts";

const BSC_RPC_URL = Deno.env.get("BSC_RPC_URL") ?? "https://bsc-dataseed.binance.org/";
const SOLANA_RPC_URL = Deno.env.get("SOLANA_RPC_URL") ?? "https://api.mainnet-beta.solana.com";

// USDT on BNB Smart Chain (18 decimals) and USDT on Solana (6 decimals).
const BEP20_TOKEN_CONTRACT =
  Deno.env.get("BEP20_TOKEN_CONTRACT") ?? "0x55d398326f99059fF775485246999027B3197955";
const BEP20_TOKEN_DECIMALS = Number(Deno.env.get("BEP20_TOKEN_DECIMALS") ?? "18");
const BEP20_TOKEN_SYMBOL = Deno.env.get("BEP20_TOKEN_SYMBOL") ?? "USDT";

const SOL_TOKEN_MINT =
  Deno.env.get("SOL_TOKEN_MINT") ?? "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const SOL_TOKEN_DECIMALS = Number(Deno.env.get("SOL_TOKEN_DECIMALS") ?? "6");
const SOL_TOKEN_SYMBOL = Deno.env.get("SOL_TOKEN_SYMBOL") ?? "USDT";

const PLAN_AMOUNTS: Record<string, number> = { "1": 60, "2": 120, "3": 180, "4": 250 };
const PLAN_DAYS = 365;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const INVALID_TX_REASON = "Invalid transaction hash or transaction not found";
/** BEP20 / EVM transaction hash: 0x + 32 bytes. */
const BEP20_HASH_RE = /^0x[0-9a-f]{64}$/;
/**
 * Solana signatures are base58-encoded 64-byte values. Real signatures are
 * normally 87-88 characters; allow 64-90 for leading-zero encodings while still
 * rejecting arbitrary strings like "trefdhdt564uf6ifhr7895" up front.
 */
const SOLANA_SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

type Network = "BEP20" | "SOL";

type VerifyRequest = {
  tx_hash?: string;
  network?: string;
  plan_id?: string | number | null;
  user_id?: string | null;
  transaction_id?: string | null;
  force?: boolean;
};

type TransactionRow = {
  id: string;
  user_id: string | null;
  type: string;
  status: string;
  amount: number | string;
  deposit_amount: number | string | null;
  plan_name: string | null;
  network: string | null;
  tx_hash: string | null;
};

type VerifyOutcome =
  | { status: "completed"; received: string; expected: string }
  | { status: "rejected"; reason: string }
  | { status: "pending"; reason: string };

type EvmLog = { address?: string; topics?: string[]; data?: string };
type EvmReceipt = { status?: string; logs?: EvmLog[] };

type SolInstruction = {
  program?: string;
  parsed?: { type?: string; info?: Record<string, unknown> };
};
type SolTokenBalance = {
  accountIndex: number;
  mint?: string;
  owner?: string;
  uiTokenAmount?: { amount?: string; decimals?: number };
};
type SolTransaction = {
  meta?: {
    err?: unknown;
    preTokenBalances?: SolTokenBalance[];
    postTokenBalances?: SolTokenBalance[];
  } | null;
  transaction?: { message?: { instructions?: SolInstruction[] } };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Constant-time-ish compare so the shared secret is not leaked by timing. */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAuthorized(request: Request): boolean {
  const secret =
    Deno.env.get("VERIFY_DEPOSIT_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!secret) return false;
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const cronSecret = (request.headers.get("x-cron-secret") ?? "").trim();
  return safeEqual(bearer, secret) || safeEqual(cronSecret, secret);
}

function normalizeNetwork(value: string | null | undefined): Network | null {
  const raw = (value ?? "").trim().toUpperCase();
  if (raw === "BEP20" || raw === "BSC" || raw === "BNB" || raw === "ERC20") return "BEP20";
  if (raw === "SOL" || raw === "SOLANA") return "SOL";
  return null;
}

function normalizePlanName(value: string | null, planId?: string | number | null): string {
  const match = /plan\s*([1-4])/i.exec(value ?? "");
  if (match?.[1]) return `Plan ${match[1]}`;
  const digits = String(planId ?? "").replace(/\D/g, "");
  if (PLAN_AMOUNTS[digits]) return `Plan ${digits}`;
  return value?.trim() || "Plan";
}

/** Converts a USD/stablecoin amount to integer base units without float drift. */
function toBaseUnits(amount: number, decimals: number): bigint {
  const fixed = amount.toFixed(decimals);
  const [whole = "0", fraction = ""] = fixed.split(".");
  const padded = (fraction + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded === "" ? "0" : padded);
}

function formatUnits(value: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      result?: T;
      error?: { message?: string };
    };
    if (payload.error) {
      throw new Error(payload.error.message ?? `RPC ${method} failed`);
    }
    return payload.result as T;
  } finally {
    clearTimeout(timer);
  }
}

function platformWallet(network: Network): string {
  const value =
    network === "BEP20"
      ? (Deno.env.get("PLATFORM_WALLET_BEP20") ?? Deno.env.get("PLATFORM_WALLET_ADDRESS"))
      : (Deno.env.get("PLATFORM_WALLET_SOL") ?? Deno.env.get("PLATFORM_WALLET_ADDRESS"));
  if (!value) {
    throw new Error(
      network === "BEP20"
        ? "PLATFORM_WALLET_BEP20 secret is not configured"
        : "PLATFORM_WALLET_SOL secret is not configured",
    );
  }
  return value.trim();
}

async function verifyBep20(txHash: string, expectedUsd: number): Promise<VerifyOutcome> {
  const platform = platformWallet("BEP20");
  const hash = txHash.trim().toLowerCase();

  // Reject malformed input before it reaches the node. This is the class of
  // error that previously surfaced as a 502, e.g.:
  //   invalid argument 0: json: cannot unmarshal hex string without 0x prefix
  //   into Go value of type common.Hash
  if (!BEP20_HASH_RE.test(hash)) {
    return { status: "rejected", reason: INVALID_TX_REASON };
  }

  let receipt: EvmReceipt | null;
  try {
    receipt = await rpc<EvmReceipt | null>(BSC_RPC_URL, "eth_getTransactionReceipt", [hash]);
  } catch (error) {
    // A thrown RPC error (bad params, provider rejection, etc.) means this hash
    // can never verify. Mark it rejected instead of retrying every 30 seconds.
    const message = error instanceof Error ? error.message : "RPC request failed";
    console.error("[verify-crypto-deposit] BEP20 RPC failed", { hash, message });
    return { status: "rejected", reason: INVALID_TX_REASON };
  }

  // Well-formed but not mined yet — the cron poller calls us again next tick.
  if (!receipt) return { status: "pending", reason: "Transaction is not mined yet" };
  if (receipt.status && receipt.status !== "0x1") {
    return { status: "rejected", reason: "Transaction reverted on-chain" };
  }

  const decimals = Number.isInteger(BEP20_TOKEN_DECIMALS) ? BEP20_TOKEN_DECIMALS : 18;
  const platformTopic = `0x${platform.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
  const tokenAddress = BEP20_TOKEN_CONTRACT.toLowerCase();

  let received = 0n;
  for (const log of receipt.logs ?? []) {
    if ((log.address ?? "").toLowerCase() !== tokenAddress) continue;
    const topics = log.topics ?? [];
    if ((topics[0] ?? "").toLowerCase() !== TRANSFER_TOPIC) continue;
    if ((topics[2] ?? "").toLowerCase() !== platformTopic) continue;
    const raw = log.data && log.data !== "0x" ? log.data : "0";
    received += BigInt(raw);
  }

  if (received === 0n) {
    return {
      status: "rejected",
      reason: `No ${BEP20_TOKEN_SYMBOL} transfer to the platform wallet was found in this transaction`,
    };
  }

  const expected = toBaseUnits(expectedUsd, decimals);
  if (received < expected) {
    return {
      status: "rejected",
      reason: `Underpaid: received ${formatUnits(received, decimals)} ${BEP20_TOKEN_SYMBOL}, expected ${expectedUsd}`,
    };
  }

  return {
    status: "completed",
    received: `${formatUnits(received, decimals)} ${BEP20_TOKEN_SYMBOL}`,
    expected: `${expectedUsd} ${BEP20_TOKEN_SYMBOL}`,
  };
}

async function verifySolana(txHash: string, expectedUsd: number): Promise<VerifyOutcome> {
  const platform = platformWallet("SOL");
  const signature = txHash.trim();

  // Reject malformed signatures before calling the RPC. Solana returns a JSON-RPC
  // error for bad input, which used to bubble up as a 502.
  if (!SOLANA_SIGNATURE_RE.test(signature)) {
    return { status: "rejected", reason: INVALID_TX_REASON };
  }

  let tx: SolTransaction | null;
  try {
    tx = await rpc<SolTransaction | null>(SOLANA_RPC_URL, "getTransaction", [
      signature,
      {
        encoding: "jsonParsed",
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      },
    ]);
  } catch (error) {
    // Invalid signature / provider-side parsing error: reject, do not retry.
    const message = error instanceof Error ? error.message : "RPC request failed";
    console.error("[verify-crypto-deposit] Solana RPC failed", { signature, message });
    return { status: "rejected", reason: INVALID_TX_REASON };
  }

  if (!tx) return { status: "pending", reason: "Transaction is not confirmed yet" };
  if (tx.meta?.err) return { status: "rejected", reason: "Transaction failed on-chain" };

  // Native SOL mode (opt-in): compare lamports received using SOL_USD_PRICE.
  if (SOL_TOKEN_MINT.toLowerCase() === "native") {
    const price = Number(Deno.env.get("SOL_USD_PRICE") ?? "0");
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("SOL_USD_PRICE must be configured for native SOL deposits");
    }
    let lamports = 0;
    for (const instruction of tx.transaction?.message?.instructions ?? []) {
      if (instruction.program !== "system" || instruction.parsed?.type !== "transfer") continue;
      const info = instruction.parsed?.info ?? {};
      if (String(info["destination"] ?? "") !== platform) continue;
      lamports += Number(info["lamports"] ?? 0);
    }
    const expectedLamports = Math.round((expectedUsd / price) * 1_000_000_000);
    if (lamports === 0) {
      return { status: "rejected", reason: "No SOL transfer to the platform wallet was found" };
    }
    if (lamports < expectedLamports) {
      return {
        status: "rejected",
        reason: `Underpaid: received ${(lamports / 1e9).toFixed(6)} SOL, expected ${(expectedLamports / 1e9).toFixed(6)} SOL`,
      };
    }
    return {
      status: "completed",
      received: `${(lamports / 1e9).toFixed(6)} SOL`,
      expected: `${(expectedLamports / 1e9).toFixed(6)} SOL`,
    };
  }

  // SPL stablecoin mode (default): use the token-balance delta of the platform
  // wallet's associated token account. This is robust to ATA creation and to
  // transfers routed through programs other than the token program.
  const decimals = Number.isInteger(SOL_TOKEN_DECIMALS) ? SOL_TOKEN_DECIMALS : 6;
  const before = new Map<number, bigint>();
  for (const balance of tx.meta?.preTokenBalances ?? []) {
    before.set(balance.accountIndex, BigInt(balance.uiTokenAmount?.amount ?? "0"));
  }

  let received = 0n;
  for (const balance of tx.meta?.postTokenBalances ?? []) {
    if (balance.mint !== SOL_TOKEN_MINT || balance.owner !== platform) continue;
    const previous = before.get(balance.accountIndex) ?? 0n;
    const current = BigInt(balance.uiTokenAmount?.amount ?? "0");
    if (current > previous) received += current - previous;
  }

  if (received === 0n) {
    return {
      status: "rejected",
      reason: `No ${SOL_TOKEN_SYMBOL} transfer to the platform wallet was found in this transaction`,
    };
  }

  const expected = toBaseUnits(expectedUsd, decimals);
  if (received < expected) {
    return {
      status: "rejected",
      reason: `Underpaid: received ${formatUnits(received, decimals)} ${SOL_TOKEN_SYMBOL}, expected ${expectedUsd}`,
    };
  }

  return {
    status: "completed",
    received: `${formatUnits(received, decimals)} ${SOL_TOKEN_SYMBOL}`,
    expected: `${expectedUsd} ${SOL_TOKEN_SYMBOL}`,
  };
}

type ReferralBonusResult = {
  awarded?: boolean;
  reason?: string;
  bonus?: number;
  referrer_id?: string;
  deposit_tx_id?: string;
  transaction_id?: string;
};

/**
 * Pay the referrer their 10% bonus for a completed deposit.
 *
 * The balance credit and the transactions row happen inside
 * public.process_referral_bonus() (see the process_referral_bonus migration),
 * so the two writes are atomic and the award is idempotent per deposit.
 *
 * Never throws: the deposit is already confirmed on-chain, so a referral
 * problem must not fail or retry the verification.
 */
async function awardReferralBonus(
  admin: ReturnType<typeof createClient>,
  depositTxId: string,
): Promise<ReferralBonusResult | null> {
  try {
    const { data, error } = await admin.rpc("process_referral_bonus", {
      p_deposit_tx_id: depositTxId,
    });

    if (error) {
      const missingFunction = error.code === "PGRST202" || error.code === "42883";
      console.error(
        missingFunction
          ? "[verify-crypto-deposit] referral bonus RPC is missing — run supabase/migrations/20261025000000_process_referral_bonus.sql"
          : "[verify-crypto-deposit] referral bonus RPC failed",
        { depositId: depositTxId, code: error.code, message: error.message },
      );
      return null;
    }

    const result = (data ?? null) as ReferralBonusResult | null;

    if (result?.awarded) {
      console.log("[verify-crypto-deposit] referral bonus awarded", {
        depositId: depositTxId,
        referrerId: result.referrer_id,
        bonus: result.bonus,
      });
    } else if (result && result.reason !== "no_referrer" && result.reason !== "already_awarded") {
      console.warn("[verify-crypto-deposit] referral bonus skipped", {
        depositId: depositTxId,
        reason: result.reason,
      });
    }

    return result;
  } catch (error) {
    console.error("[verify-crypto-deposit] referral bonus threw", {
      depositId: depositTxId,
      message: error instanceof Error ? error.message : String(error),
    });

    return null;
  }
}

type NotificationResult = { sent: boolean; id?: string | null; reason?: string };

/**
 * Email the depositor their receipt through the send-email Edge Function.
 *
 * Never throws: the deposit is already confirmed on-chain, so a mail problem
 * (missing RESEND_API_KEY, unverified Resend sender, no address on the account)
 * must not fail or retry the verification.
 */
async function sendDepositEmail(
  admin: ReturnType<typeof createClient>,
  args: {
    userId: string;
    amount: string;
    planName: string;
    expiresAt?: string | null;
    txHash?: string | null;
  },
): Promise<NotificationResult> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { sent: false, reason: "missing_supabase_config" };
  }

  let email: string | null = null;
  try {
    // profiles has no email column; the address lives on the auth user.
    const { data, error } = await admin.auth.admin.getUserById(args.userId);
    if (error) {
      console.warn("[verify-crypto-deposit] could not load depositor email", {
        userId: args.userId,
        message: error.message,
      });
    }
    email = data?.user?.email ?? null;
  } catch (error) {
    console.warn("[verify-crypto-deposit] depositor email lookup threw", {
      userId: args.userId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!email) {
    return { sent: false, reason: "missing_email" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        to: email,
        subject: depositEmailSubject(args),
        html: depositEmailHtml(args),
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      ok?: boolean;
      id?: string | null;
      error?: string;
    } | null;

    if (!response.ok || !payload?.ok) {
      console.error("[verify-crypto-deposit] deposit email failed", {
        userId: args.userId,
        status: response.status,
        error: payload?.error,
      });
      return { sent: false, reason: payload?.error ?? `http_${response.status}` };
    }

    console.log("[verify-crypto-deposit] deposit email sent", {
      userId: args.userId,
      id: payload.id ?? null,
    });
    return { sent: true, id: payload.id ?? null };
  } catch (error) {
    console.error("[verify-crypto-deposit] deposit email request failed", {
      userId: args.userId,
      message: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "request_failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function handle(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const secretAvailable =
    Boolean(Deno.env.get("VERIFY_DEPOSIT_SECRET")) ||
    Boolean(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  if (!secretAvailable) {
    return json({ ok: false, error: "Server is missing VERIFY_DEPOSIT_SECRET" }, 500);
  }
  if (!isAuthorized(request)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: VerifyRequest;
  try {
    body = (await request.json()) as VerifyRequest;
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const txHash = String(body.tx_hash ?? "").trim();
  if (!txHash) return json({ ok: false, error: "tx_hash is required" }, 400);

  // EVM hashes are case-insensitive; Solana signatures are not.
  const networkHint = normalizeNetwork(body.network);
  const initialStateHash = networkHint === "BEP20" ? txHash.toLowerCase() : txHash;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Supabase credentials are not configured" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The transaction row is the source of truth for amount, network and user.
  // Request fields are only fallbacks, so a caller cannot claim a smaller plan
  // while sending a smaller amount.
  const fetchDeposit = (hash: string) =>
    admin
      .from("transactions")
      .select(
        "id,user_id,type,status,amount,deposit_amount,plan_name,network,tx_hash,verification_attempts",
      )
      .eq("tx_hash", hash)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  let lookupHash = initialStateHash;
  const firstLookup = await fetchDeposit(lookupHash);
  let rowData = firstLookup.data as TransactionRow | null;
  let rowError = firstLookup.error;

  // Retry the lowercase form for mixed-case BEP20 hashes when the caller did
  // not declare a network (or declared BEP20).
  if (!rowError && !rowData && networkHint !== "SOL" && txHash !== txHash.toLowerCase()) {
    lookupHash = txHash.toLowerCase();
    const retry = await fetchDeposit(lookupHash);
    rowData = retry.data as TransactionRow | null;
    rowError = retry.error;
  }

  if (rowError) {
    console.error("[verify-crypto-deposit] transaction lookup failed", rowError);
    return json({ ok: false, error: "Failed to load transaction" }, 500);
  }

  const row = rowData;
  if (!row) {
    return json(
      { ok: false, status: "not_found", error: "No transaction found for this hash" },
      404,
    );
  }
  const chainHash = row.tx_hash ?? lookupHash;
  if (row.type !== "deposit") {
    return json({ ok: false, error: "Transaction is not a deposit" }, 400);
  }
  if (row.status === "completed") {
    return json({ ok: true, status: "already_completed", tx_hash: txHash });
  }
  if (row.status === "rejected" && !body.force) {
    return json({
      ok: true,
      status: "rejected",
      tx_hash: txHash,
      reason: "Transaction was already rejected",
    });
  }

  const network = normalizeNetwork(row.network) ?? normalizeNetwork(body.network);
  if (!network) {
    const reason = `Unsupported network: ${row.network ?? body.network ?? "unknown"}`;
    await admin
      .from("transactions")
      .update({ status: "rejected", rejection_reason: reason })
      .eq("id", row.id)
      .eq("status", "pending");
    return json({ ok: false, status: "rejected", reason }, 200);
  }

  const expectedUsd = Number(row.deposit_amount ?? row.amount);
  if (!Number.isFinite(expectedUsd) || expectedUsd <= 0) {
    const reason = "Transaction has no valid expected amount";
    await admin
      .from("transactions")
      .update({ status: "rejected", rejection_reason: reason })
      .eq("id", row.id)
      .eq("status", "pending");
    return json({ ok: false, status: "rejected", reason }, 200);
  }

  let outcome: VerifyOutcome;
  try {
    outcome =
      network === "BEP20"
        ? await verifyBep20(chainHash, expectedUsd)
        : await verifySolana(chainHash, expectedUsd);
  } catch (error) {
    // Only server-side/configuration faults reach this point (RPC errors are
    // handled and rejected inside the verify helpers). Never return 5xx to the
    // cron poller: reply 200 with pending so the next tick retries, bounded by
    // verification_attempts.
    const message = error instanceof Error ? error.message : "Verification failed";
    console.error("[verify-crypto-deposit] verification error", { txHash, network, message });
    await admin
      .from("transactions")
      .update({ last_verification_at: new Date().toISOString() })
      .eq("id", row.id);
    return json({ ok: false, status: "pending", tx_hash: txHash, error: message }, 200);
  }

  const now = new Date();

  if (outcome.status === "pending") {
    await admin
      .from("transactions")
      .update({ last_verification_at: now.toISOString() })
      .eq("id", row.id);
    return json({ ok: true, status: "pending", tx_hash: txHash, reason: outcome.reason }, 200);
  }

  if (outcome.status === "rejected") {
    const { data: updated, error } = await admin
      .from("transactions")
      .update({
        status: "rejected",
        rejection_reason: outcome.reason,
        last_verification_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[verify-crypto-deposit] could not reject transaction", error);
      return json({ ok: false, error: "Failed to update transaction" }, 500);
    }
    if (!updated) {
      // A concurrent call already decided this transaction.
      return json({ ok: true, status: "already_processed", tx_hash: txHash });
    }
    return json({ ok: true, status: "rejected", tx_hash: txHash, reason: outcome.reason }, 200);
  }

  // Success: flip the deposit first, guarded by status=pending so a concurrent
  // invocation cannot activate the plan twice.
  const { data: updated, error: updateError } = await admin
    .from("transactions")
    .update({
      status: "completed",
      rejection_reason: null,
      last_verification_at: now.toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("[verify-crypto-deposit] could not complete transaction", updateError);
    return json({ ok: false, error: "Failed to update transaction" }, 500);
  }
  if (!updated) {
    return json({ ok: true, status: "already_processed", tx_hash: txHash });
  }

  // The deposit is committed as completed — pay the referrer's 10% bonus now.
  // It does not depend on plan activation, so a profile problem below cannot
  // skip it, and a referral problem cannot undo the verified deposit.
  const referral = await awardReferralBonus(admin, row.id);

  const planName = normalizePlanName(row.plan_name, body.plan_id);
  const expiresAt = new Date(now.getTime() + PLAN_DAYS * 24 * 60 * 60 * 1000);
  let notification: NotificationResult | null = null;

  if (row.user_id) {
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        plan_name: planName,
        plan_started_at: now.toISOString(),
        plan_expires_at: expiresAt.toISOString(),
      })
      .eq("id", row.user_id);

    if (profileError) {
      // The payment is confirmed; log the profile problem for an admin to fix
      // but never roll the successful deposit back.
      console.error("[verify-crypto-deposit] could not activate plan", profileError);
      return json(
        {
          ok: true,
          status: "completed",
          tx_hash: txHash,
          received: outcome.received,
          referral,
          warning: "Deposit completed but the profile plan could not be updated",
        },
        200,
      );
    }

    // The plan is active — tell the user. Best effort: the response stays 200
    // and the deposit stays completed even when the mail cannot be delivered.
    notification = await sendDepositEmail(admin, {
      userId: row.user_id,
      amount: outcome.received,
      planName,
      expiresAt: expiresAt.toISOString(),
      txHash: chainHash,
    });
  }

  return json(
    {
      ok: true,
      status: "completed",
      tx_hash: txHash,
      received: outcome.received,
      expected: outcome.expected,
      plan_name: planName,
      referral,
      email: notification,
    },
    200,
  );
}

Deno.serve(handle);
