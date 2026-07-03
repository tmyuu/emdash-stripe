/**
 * Stripe client + money/signing helpers for emdash-stripe.
 *
 * Everything here is host-agnostic: no EmDash imports, no KV access. The
 * plugin runs in-process inside the host Worker, so stripe-node talks to the
 * Stripe API through the platform `fetch` and signs with Web Crypto.
 */

import Stripe from "stripe";

/**
 * Build a Stripe client. stripe-node v22 resolves a Workers-native build via
 * the `workerd` export condition (fetch + SubtleCrypto by default); passing
 * the fetch HTTP client explicitly keeps behavior identical on non-Workers
 * dev servers (e.g. a Node-based `astro dev`).
 *
 * `apiVersion` is intentionally omitted: requests use the SDK's pinned
 * version, which is what the bundled TypeScript types describe.
 */
export function getStripe(secretKey: string): Stripe {
  return new Stripe(secretKey, {
    httpClient: Stripe.createFetchHttpClient(),
  });
}

// --- currency handling ---------------------------------------------------------
// Per https://docs.stripe.com/currencies (verified 2026-07): charge amounts in
// these currencies are expressed without a decimal part. ISK and UGX are
// excluded on purpose — Stripe treats them like two-decimal currencies on the
// wire (amounts ×100 with the last two digits 00).
const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "vnd", "vuv", "xaf", "xof", "xpf",
]);

// Three-decimal currencies: amounts use the smallest unit (×1000) but Stripe
// requires the last digit to be zero.
const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

/**
 * Convert an amount expressed in major units (e.g. 10.99 USD, 1000 JPY) to
 * the minor-unit integer Stripe expects (1099, 1000).
 */
export function toMinorUnits(amount: number, currency: string): number {
  const c = currency.toLowerCase();
  if (ZERO_DECIMAL.has(c)) return Math.round(amount);
  if (THREE_DECIMAL.has(c)) return Math.round((amount * 1000) / 10) * 10;
  return Math.round(amount * 100);
}

/**
 * Render a minor-unit amount as a human-readable string for the admin UI
 * (e.g. `1099 usd` → "10.99 USD", `1000 jpy` → "1000 JPY").
 */
export function formatAmount(minor: number, currency: string): string {
  const c = currency.toLowerCase();
  const decimals = ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
  const divisor = decimals === 0 ? 1 : decimals === 3 ? 1000 : 100;
  return `${(minor / divisor).toFixed(decimals)} ${currency.toUpperCase()}`;
}

// --- forwarding signature ------------------------------------------------------
/**
 * HMAC-SHA256 over `payload` with `secret`, hex-encoded. Used to sign
 * forwarded webhook events (`X-Emdash-Stripe-Signature: t=<unix>,v1=<hex>`
 * where the signed payload is `<unix>.<body>`), mirroring Stripe's own
 * signature scheme so hosts can verify with a few lines of Web Crypto.
 */
export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
