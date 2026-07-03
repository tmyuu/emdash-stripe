# emdash-stripe

Stripe payments for [EmDash CMS](https://docs.emdashcms.com). Sell what your CMS already knows about: map any collection as sellable and this plugin turns its entries into Stripe Checkout Sessions, Payment Intents, and subscriptions — with verified webhooks, payment records in the admin, and clean extension points for your site to react to payments.

As of mid-2026 there is no other working Stripe integration for EmDash (the official payments story is crypto-only x402; prior third-party attempts are unpublished or handle webhooks unverified).

## Design principles

- **CMS entries are the source of truth.** Requests reference entries by collection + id/slug; prices are read server-side from the published entry. Clients can never set amounts.
- **Two price sources per entry.** A numeric price field (charged via inline `price_data`, zero Stripe catalog management) or a Stripe Price ID field (`price_...` — bringing Stripe-managed pricing and subscriptions). The Price ID wins when both exist.
- **Verified webhooks, always.** Every delivery is re-fetched from the Stripe API before processing (see [Webhook model](#webhook-model)), and deduplicated.
- **The host stays in charge of fulfillment.** The plugin records payments; your site reacts via CMS order entries and/or signed event forwarding — no email templates or cart logic baked in.

## Requirements

- EmDash **0.27+**, registered in-process via `plugins:` (not `sandboxed:` — stripe-node needs the host Worker's `fetch`/`SubtleCrypto`).
- A Stripe account and secret key.

## Install

```sh
pnpm add github:tmyuu/emdash-stripe   # or npm i emdash-stripe once published
```

```js
// astro.config.mjs
import emdash from "emdash/astro";
import stripePayments from "emdash-stripe";

export default defineConfig({
  integrations: [
    emdash({
      plugins: [stripePayments()],
    }),
  ],
});
```

## Setup

1. **Keys** — set `STRIPE_SECRET_KEY` (and optionally `STRIPE_PUBLISHABLE_KEY`) as Worker secrets, or paste them on the admin **Stripe → Settings** page (the settings page value wins).
2. **Sellable collections** — on the settings page, map collections to fields (JSON):

   ```json
   [
     {
       "collection": "products",
       "priceField": "price",
       "priceIdField": "stripePriceId",
       "nameField": "name",
       "descriptionField": "description",
       "imageField": "image",
       "currencyField": "currency"
     }
   ]
   ```

   Only `collection` is required; the values above are the defaults (`descriptionField`/`imageField`/`currencyField` are off unless set). Only **published** entries are sellable.

   To sell an entry as a **subscription without a Stripe Price** (inline
   `price_data.recurring`, CMS stays the source of truth), add recurring
   fields to its mapping — request items opt in with `"recurring": true`:

   ```json
   {
     "collection": "products",
     "recurringEnabledField": "subscription_enabled",
     "recurringPriceField": "subscription_price",
     "recurringIntervalCountField": "subscription_interval_months",
     "recurringNameTemplate": "{name} — every {count} {interval}(s)"
   }
   ```

   `recurringPriceField` falls back to `priceField`; the interval comes from
   `recurringIntervalField` (entry value `day`/`week`/`month`/`year`) or the
   fixed `recurringInterval` (default `month`); the count from
   `recurringIntervalCountField` or the fixed `recurringIntervalCount`
   (default 1). `recurringEnabledField`, when set, gates which entries may
   recur. `recurringNameTemplate` renders the line-item display name
   (placeholders `{name}`, `{count}`, `{interval}`).
3. **Currency & price unit** — set the default currency (used when an entry has no currency field) and how numeric prices are interpreted: **major units** (`10.99` = $10.99, `1000` = ¥1000 — zero/three-decimal currencies handled per Stripe rules) or **minor units** (passed as-is).
4. **Webhook** — register the URL shown on the settings page (`https://your-site/_emdash/api/plugins/stripe/webhook`) in the Stripe Dashboard → Developers → Webhooks. Recommended events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, and for subscriptions `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`. No signing secret is needed (see [Webhook model](#webhook-model)).

## Routes

All routes are `POST` with a JSON body, mounted at `/_emdash/api/plugins/stripe/<route>`.

> **Response envelope**: EmDash wraps plugin route responses in
> `{ "data": <payload> }`. The payloads documented below are what you find
> under `data`.

### `checkout` — create a Checkout Session

```jsonc
{
  "items": [{ "collection": "products", "id": "abc123", "quantity": 2 }],
  // or reference by slug: { "slug": "herbal-tea", "quantity": 1 }
  // or sell as a subscription (mapping's recurring fields): { "slug": "herbal-tea", "recurring": true }
  "uiMode": "hosted",              // "hosted" (default) or "embedded"
  "mode": "payment",               // optional; auto-detects "subscription" for recurring items
  "successPath": "/thanks",        // optional site-relative overrides
  "cancelPath": "/cart",
  "customerEmail": "a@example.com",// optional (ignored when a trusted customer is attached)
  "clientReference": "order-42",   // optional → client_reference_id
  "metadata": { "note": "gift" },  // optional → session metadata + (payment mode) PI metadata
  "trusted": "v1.…"                // optional host-signed token (see Host-signed requests)
}
```

Hosted response: `{ "ok": true, "id": "cs_...", "url": "https://checkout.stripe.com/..." }` → redirect the browser to `url`.
Embedded response: `{ "ok": true, "id": "cs_...", "clientSecret": "cs_..._secret_..." }` → pass to Stripe.js embedded checkout.

`collection` defaults to the first mapping. Promotion codes, automatic tax, phone collection, shipping-address countries, **marketing-consent collection** (`consent_collection.promotions` — a Stripe feature unavailable in some account countries, e.g. Japan; leave the toggle off there or payment-mode session creation fails), and **abandoned-checkout recovery** (`after_expiration.recovery` — recovery URLs arrive on `checkout.session.expired`) are toggled globally on the settings page. In payment mode the item summary and client `metadata` also ride on the PaymentIntent (`payment_intent_data.description` / `.metadata`) so host order records can key off the PI. A `session_id={CHECKOUT_SESSION_ID}` query parameter is appended to the success/return URL.

```html
<button id="buy">Buy</button>
<script>
  document.getElementById("buy").addEventListener("click", async () => {
    const res = await fetch("/_emdash/api/plugins/stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [{ slug: "herbal-tea", quantity: 1 }] }),
    });
    const { ok, url } = await res.json();
    if (ok) location.href = url;
  });
</script>
```

### `payment-intent` — for custom payment UIs (Payment Element)

```jsonc
{
  "items": [{ "id": "abc123", "quantity": 1 }],
  "receiptEmail": "a@example.com",  // optional
  "description": "…",               // optional
  "metadata": {},                   // optional
  "trusted": "v1.…"                 // optional host-signed token (customer, setupFutureUsage)
}
```

Response: `{ "ok": true, "id": "pi_...", "clientSecret": "pi_..._secret_...", "amount": 1099, "currency": "usd" }`. One-time prices only (subscriptions require Checkout).

### Host-signed requests (`trusted`)

Some parameters act on a Stripe Customer and must never be public-caller
controlled — anyone could otherwise mint sessions against someone else's
saved cards. The host application (which owns authentication) passes them in
a `trusted` token signed with the **forwarding secret** (the host↔plugin
shared secret, same scheme as forwarded events, opposite direction):

```
trusted = "v1." + t + "." + payloadB64 + "." + hex(HMAC-SHA256(secret, t + "." + payloadB64))
```

where `t` is a unix timestamp (±300 s accepted) and `payloadB64` is
base64url-encoded JSON. Supported payload fields:

| Field | Routes | Effect |
|---|---|---|
| `customer` | `checkout`, `payment-intent` | Attach an existing Customer (`cus_…`) — saved cards, subscription-customer linkage |
| `setupFutureUsage` | `payment-intent` | `on_session` / `off_session` (requires `customer`) |

```ts
async function trustedToken(secret: string, payload: object): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${b64}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `v1.${t}.${b64}.${hex}`;
}
```

A request with a malformed, stale, or mis-signed token fails with
`invalid_trusted`; setting `trusted` while no forwarding secret is configured
fails with `trusted_not_configured`.

### `session` — success-page status lookup

`{ "sessionId": "cs_..." }` → `{ "ok": true, "status": "complete", "paymentStatus": "paid", "amountTotal": 1099, "currency": "usd", "customerEmail": "...", "clientReferenceId": "..." }`

### `config` — public site config

`{}` → `{ "ok": true, "publishableKey": "pk_...", "currency": "usd", "collections": ["products"], "successPath": "/checkout/success", "cancelPath": "/checkout/cancel" }`

### Error shape

All routes return `{ "ok": false, "error": "<code>", "detail"?: "…" }` on failure — e.g. `not_configured`, `unknown_collection`, `unknown_item`, `missing_price`, `mixed_currencies`, `recurring_requires_subscription`, `stripe_error`.

## Webhook model

EmDash parses plugin-route request bodies before handlers run, so the raw bytes required for Stripe *signature* verification never reach a plugin. This plugin therefore uses Stripe's other supported authenticity model: the delivery is treated as an untrusted notification — the handler validates the event ID shape, **re-fetches the event from the Stripe API**, and processes only what Stripe returns. A forged POST can, at worst, make the plugin re-read a real event, which the KV idempotency marker then deduplicates. Unverifiable deliveries are not acknowledged, so Stripe retries genuine events.

Verified events update the **payments** storage collection (visible on the admin *Payments* page): Checkout Sessions, plugin-created Payment Intents, refunds, subscriptions, and invoices.

## Reacting to payments (fulfillment)

Two optional, composable mechanisms:

### 1. CMS order entries

Set **Orders collection** on the settings page to a collection slug. On each successful payment the plugin creates one entry there (deduplicated). The collection must define these fields:

| Field slug | Type | Content |
|---|---|---|
| `title` | text | `Order XXXXXXXX` summary |
| `stripeId` | text | Checkout Session / PaymentIntent ID |
| `paymentIntentId` | text | PaymentIntent ID (if any) |
| `amount` | number | total, minor units |
| `currency` | text | ISO code |
| `email` | text | customer email |
| `customerName` | text | customer name |
| `status` | text | `paid` |
| `items` | text | JSON `[{"c": collection, "id": entryId, "q": qty}]` |

### 2. Signed event forwarding

Set **Forward events to URL** + **Forwarding secret**. Every verified event is POSTed to your endpoint (an API route in your Astro site, typically) with header `X-Emdash-Stripe-Signature: t=<unix>,v1=<hex>` where `v1 = HMAC-SHA256(secret, "<t>.<body>")`:

```ts
// src/pages/api/fulfill.ts
export const POST: APIRoute = async ({ request }) => {
  const body = await request.text();
  const sig = request.headers.get("x-emdash-stripe-signature") ?? "";
  const [, t, v1] = sig.match(/^t=(\d+),v1=([0-9a-f]+)$/) ?? [];
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return new Response(null, { status: 400 });

  const event = JSON.parse(body); // a verified Stripe Event
  if (event.type === "checkout.session.completed") {
    // send your branded email, decrement stock, notify Slack, ...
  }
  return new Response("ok");
};
```

Forwarding is at-least-once, backed by Stripe's webhook retries: the plugin
acknowledges a delivery only after your endpoint responds 2xx, so a non-2xx
response or an unreachable endpoint means Stripe redelivers the event later
and the plugin re-forwards it. Make your handler idempotent (key on
`event.id`) and return non-2xx when your fulfillment fails.

**Forwarding to the host Worker itself** (the usual case — the plugin runs
in-process in your site, and the fulfillment route lives on the same Worker):
Cloudflare blocks a Worker from fetching its own hostname (the subrequest
dies with HTTP 522), so plain `fetch` can never reach the URL. Add a service
binding pointing at the Worker itself and set **Forward via service binding**
to its name:

```jsonc
// wrangler.jsonc
"services": [{ "binding": "SELF", "service": "<your-worker-name>" }]
```

Leave the setting blank when forwarding to a different origin.

## Subscriptions

Two paths, both auto-switching `checkout` to subscription mode (or pass `"mode": "subscription"`):

- **Stripe Price ID** — give an entry a `priceIdField` pointing at a **recurring** Price (Stripe manages the catalog).
- **Inline recurring `price_data`** — configure the mapping's recurring fields (see [Setup §2](#setup)) and send `"recurring": true` on the item; price and billing interval come from the CMS entry.

Subscription lifecycle and invoice events are recorded, and session metadata is propagated to the Subscription so events trace back to CMS entries.

## Notes & limitations

- **In-process only.** Whether stripe-node works inside EmDash's sandboxed isolates is unverified; marketplace (sandboxed) distribution is a v2 goal.
- Amounts are authoritative from Stripe at webhook time — records never trust client-side totals.
- Saved cards / Customer Portal / cart state are host-app concerns and intentionally out of scope for v1.
- Test with `stripe trigger checkout.session.completed` (Stripe CLI) — re-fetch verification works with CLI-triggered test events; `stripe listen --forward-to` also works since payloads only need a valid event ID.

## Development

```sh
pnpm build       # tsdown → dist/ (committed, so github: installs work)
pnpm typecheck   # tsc --noEmit
```

## License

MIT © Yushi Matsui
