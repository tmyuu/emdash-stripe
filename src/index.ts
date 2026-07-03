/**
 * emdash-stripe
 *
 * EmDash CMS plugin (standard format): Stripe payments for content entries.
 *
 * CMS entries are the source of truth for what is sellable. Any collection can
 * be mapped as sellable; each entry provides either a numeric price field
 * (charged via inline `price_data` — no Stripe catalog sync) or a Stripe Price
 * ID field (`price_...`, which also enables subscriptions). The plugin exposes:
 *
 *   - `checkout`       (public) — create a hosted or embedded Checkout Session
 *   - `payment-intent` (public) — create a PaymentIntent for custom payment UIs
 *   - `session`        (public) — read a session's status (success pages)
 *   - `config`         (public) — publishable key + sellable collections
 *   - `webhook`        (public) — Stripe webhook endpoint
 *   - `admin`                   — Block Kit settings + payments pages
 *
 *   - `src/index.ts`        → this descriptor factory (`PluginDescriptor`)
 *   - `src/sandbox-entry.ts`→ routes (checkout/webhook/...) + payment records
 *   - `src/admin.ts`        → Block Kit admin pages
 *   - `src/config.ts`       → runtime settings (KV + env fallback)
 *   - `src/stripe.ts`       → Stripe client + currency/signing helpers
 *
 * Register it in `astro.config.mjs`:
 *
 *   import emdash from 'emdash/astro';
 *   import stripePayments from 'emdash-stripe';
 *
 *   export default defineConfig({
 *     integrations: [
 *       emdash({
 *         // Must be `plugins:` (in-process), NOT `sandboxed:` — stripe-node
 *         // needs the host Worker's global fetch/SubtleCrypto, which are not
 *         // verified inside an isolate.
 *         plugins: [stripePayments()],
 *       }),
 *     ],
 *   });
 *
 * Webhook authenticity: EmDash parses route request bodies before handlers
 * run, so the raw bytes needed for Stripe signature verification never reach
 * the plugin. Instead the webhook handler treats each delivery as an
 * untrusted notification, re-fetches the event by ID from the Stripe API, and
 * processes only what Stripe returns — forged payloads cannot inject data.
 *
 * Configuration (API keys, currency, collection mappings, checkout options)
 * is done at runtime from the plugin's admin settings page; the secret /
 * publishable keys may also come from the host Worker env
 * (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`).
 */

import type { PluginDescriptor } from "emdash";

/**
 * Build the EmDash plugin descriptor for Stripe payments. Takes no arguments —
 * everything is configured from the admin settings page (see sandbox-entry).
 */
export function stripePayments(): PluginDescriptor {
  return {
    id: "stripe",
    version: "0.4.0",
    format: "standard",
    entrypoint: "emdash-stripe/sandbox",
    // content:read — resolve sellable entries (names/prices) server-side.
    // content:write — optional: create order entries in a host-chosen
    //                 collection when payments succeed (off by default).
    // network:request — all outbound traffic goes to the Stripe API.
    capabilities: ["content:read", "content:write", "network:request"],
    allowedHosts: ["api.stripe.com"],
    adminPages: [
      { path: "/settings", label: "Stripe", icon: "plug" },
      { path: "/payments", label: "Payments", icon: "inbox" },
    ],
    storage: {
      payments: {
        indexes: ["createdAt", "status"],
      },
    },
  };
}

export default stripePayments;
