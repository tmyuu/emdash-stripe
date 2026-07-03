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
3. **Currency & price unit** — set the default currency (used when an entry has no currency field) and how numeric prices are interpreted: **major units** (`10.99` = $10.99, `1000` = ¥1000 — zero/three-decimal currencies handled per Stripe rules) or **minor units** (passed as-is).
4. **Webhook** — register the URL shown on the settings page (`https://your-site/_emdash/api/plugins/stripe/webhook`) in the Stripe Dashboard → Developers → Webhooks. Recommended events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, and for subscriptions `customer.subscription.*`, `invoice.paid`, `invoice.payment_failed`. No signing secret is needed (see [Webhook model](#webhook-model)).

## Routes

All routes are `POST` with a JSON body, mounted at `/_emdash/api/plugins/stripe/<route>`.

### `checkout` — create a Checkout Session

```jsonc
{
  "items": [{ "collection": "products", "id": "abc123", "quantity": 2 }],
  // or reference by slug: { "slug": "herbal-tea", "quantity": 1 }
  "uiMode": "hosted",              // "hosted" (default) or "embedded"
  "mode": "payment",               // optional; auto-detects "subscription" for recurring Prices
  "successPath": "/thanks",        // optional site-relative overrides
  "cancelPath": "/cart",
  "customerEmail": "a@example.com",// optional
  "clientReference": "order-42",   // optional → client_reference_id
  "metadata": { "note": "gift" }   // optional, forwarded to Stripe metadata
}
```

Hosted response: `{ "ok": true, "id": "cs_...", "url": "https://checkout.stripe.com/..." }` → redirect the browser to `url`.
Embedded response: `{ "ok": true, "id": "cs_...", "clientSecret": "cs_..._secret_..." }` → pass to Stripe.js embedded checkout.

`collection` defaults to the first mapping. Promotion codes, automatic tax, phone collection, and shipping-address countries are toggled globally on the settings page. A `session_id={CHECKOUT_SESSION_ID}` query parameter is appended to the success/return URL.

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
  "metadata": {}                    // optional
}
```

Response: `{ "ok": true, "id": "pi_...", "clientSecret": "pi_..._secret_...", "amount": 1099, "currency": "usd" }`. One-time prices only (subscriptions require Checkout).

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

## Subscriptions

Give an entry a Stripe Price ID (`priceIdField`) pointing at a **recurring** Price; `checkout` auto-switches to subscription mode (or pass `"mode": "subscription"`). Subscription lifecycle and invoice events are recorded, and session metadata is propagated to the Subscription so events trace back to CMS entries. Recurring `price_data` (CMS-defined intervals) is not supported in v1 — Stripe-managed Prices are the right tool there.

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
