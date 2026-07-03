/**
 * Sandbox entrypoint for emdash-stripe.
 *
 * Routes:
 *   - `checkout`       (public) — resolve sellable CMS entries into Stripe
 *                                 line items and create a Checkout Session
 *                                 (hosted redirect or embedded page).
 *   - `payment-intent` (public) — same resolution, but create a PaymentIntent
 *                                 for custom payment UIs (Payment Element).
 *   - `session`        (public) — status lookup for success pages.
 *   - `config`         (public) — publishable key + sellable collections, so
 *                                 the site can render buy buttons dynamically.
 *   - `webhook`        (public) — Stripe webhook endpoint (see below).
 *   - `admin`                   — Block Kit settings + payments pages.
 *
 * Prices are never trusted from the client: requests reference entries by
 * collection + id/slug, and amounts come from the published entry (numeric
 * price field → inline `price_data`) or from Stripe itself (Price ID field).
 *
 * Webhook authenticity: EmDash parses route request bodies before handlers
 * run, so the raw bytes required for Stripe signature verification never
 * reach a plugin route. The delivery is therefore treated as an untrusted
 * hint: the handler validates the event ID shape, re-fetches the event from
 * the Stripe API, and processes only what Stripe returns. A forged POST can
 * at most cause a re-fetch of a real event, which is then deduplicated via a
 * KV marker. Verified events are recorded in the `payments` storage
 * collection, optionally mirrored as CMS order entries, and optionally
 * forwarded to a host URL as an HMAC-signed POST so host apps can fulfill
 * orders, send email, etc.
 *
 * The plugin must run in-process (`plugins:`, not `sandboxed:`): stripe-node
 * relies on the host Worker's global fetch/SubtleCrypto, which are not
 * verified inside an isolate.
 */

import type {
  PluginContext,
  SandboxedPlugin,
  SandboxedRouteContext,
} from "emdash/plugin";
import type Stripe from "stripe";
import { getStripe, toMinorUnits, hmacSha256Hex } from "./stripe.js";
import { loadSettings, type CollectionMapping, type Settings } from "./config.js";
import { handleAdmin } from "./admin.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRICE_ID_RE = /^price_[A-Za-z0-9]+$/;
const EVENT_ID_RE = /^evt_[A-Za-z0-9]+$/;
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;
const METADATA_SOURCE = "emdash-stripe";

function fail(error: string, detail?: string): { ok: false; error: string; detail?: string } {
  return detail ? { ok: false, error, detail } : { ok: false, error };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Site-relative path from client input; anything else → undefined. */
function relPath(v: unknown): string | undefined {
  const s = str(v);
  return s && s.startsWith("/") && !s.startsWith("//") && s.length <= 500 ? s : undefined;
}

function withSessionParam(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
}

/** Client-supplied metadata: string→string, capped, reserved keys stripped. */
function sanitizeMetadata(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== "object") return out;
  let n = 0;
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= 20) break;
    if (!key || key.length > 40 || key === "source" || key.startsWith("emdash")) continue;
    if (typeof val !== "string" || val.length > 500) continue;
    out[key] = val;
    n += 1;
  }
  return out;
}

// --- item resolution -----------------------------------------------------------
interface ItemInput {
  collection?: unknown;
  id?: unknown;
  slug?: unknown;
  quantity?: unknown;
}

interface ResolvedItem {
  collection: string;
  entryId: string;
  name: string;
  quantity: number;
  currency: string;
  recurring: boolean;
  /** Stripe Price ID path (wins over price_data). */
  priceId?: string;
  /** Minor units. Set for price_data items and for retrieved fixed-amount Prices. */
  unitAmount: number | null;
  description?: string;
  image?: string;
}

type ResolveResult = { items: ResolvedItem[] } | { ok: false; error: string; detail?: string };

async function findBySlug(
  ctx: PluginContext,
  collection: string,
  slug: string,
): Promise<Awaited<ReturnType<NonNullable<PluginContext["content"]>["get"]>>> {
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await ctx.content!.list(collection, {
      limit: 100,
      cursor,
      where: { status: "published" },
    });
    const hit = result.items.find((e) => e.slug === slug);
    if (hit) return hit;
    if (!result.hasMore || !result.cursor) return null;
    cursor = result.cursor;
  }
  return null;
}

function resolveImage(ctx: PluginContext, v: unknown): string | undefined {
  let url: string | undefined;
  if (typeof v === "string") url = v.trim();
  else if (v && typeof v === "object") {
    const u = (v as Record<string, unknown>).url;
    if (typeof u === "string") url = u.trim();
  }
  if (!url) return undefined;
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("/") && !url.startsWith("//")) return ctx.url(url);
  return undefined;
}

async function resolveItems(
  ctx: PluginContext,
  stripe: Stripe,
  cfg: Settings,
  input: unknown,
): Promise<ResolveResult> {
  if (!Array.isArray(input) || input.length === 0 || input.length > 100) {
    return fail("invalid_items");
  }
  const items: ResolvedItem[] = [];
  for (const raw of input as ItemInput[]) {
    if (!raw || typeof raw !== "object") return fail("invalid_items");
    const collectionName = str(raw.collection) ?? cfg.mappings[0]?.collection;
    const mapping: CollectionMapping | undefined = cfg.mappings.find(
      (m) => m.collection === collectionName,
    );
    if (!mapping) return fail("unknown_collection", String(collectionName));

    const id = str(raw.id);
    const slug = str(raw.slug);
    if (!id && !slug) return fail("invalid_items");
    const entry = id
      ? await ctx.content!.get(mapping.collection, id)
      : await findBySlug(ctx, mapping.collection, slug!);
    if (!entry || entry.status !== "published") {
      return fail("unknown_item", `${mapping.collection}/${id ?? slug}`);
    }

    const qtyRaw = typeof raw.quantity === "number" ? raw.quantity : 1;
    const quantity = Math.min(999, Math.max(1, Math.floor(qtyRaw)));
    const data = entry.data;
    const name =
      str(data[mapping.nameField]) ?? str(data.title) ?? str(data.name) ?? entry.slug ?? entry.id;

    const priceId = str(data[mapping.priceIdField]);
    if (priceId && PRICE_ID_RE.test(priceId)) {
      let price: Stripe.Price;
      try {
        price = await stripe.prices.retrieve(priceId);
      } catch (err) {
        ctx.log.error(`Failed to retrieve Stripe price ${priceId}`, err as Error);
        return fail("price_lookup_failed", priceId);
      }
      if (!price.active) return fail("inactive_price", priceId);
      items.push({
        collection: mapping.collection,
        entryId: entry.id,
        name,
        quantity,
        currency: price.currency,
        recurring: price.recurring != null,
        priceId,
        unitAmount: price.unit_amount,
      });
      continue;
    }

    const priceRaw = data[mapping.priceField];
    const priceNum =
      typeof priceRaw === "number" ? priceRaw : typeof priceRaw === "string" ? Number(priceRaw) : NaN;
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return fail("missing_price", `${mapping.collection}/${entry.id}`);
    }
    const currency =
      (mapping.currencyField && str(data[mapping.currencyField])?.toLowerCase()) || cfg.currency;
    const unitAmount =
      cfg.priceUnit === "minor" ? Math.round(priceNum) : toMinorUnits(priceNum, currency);
    items.push({
      collection: mapping.collection,
      entryId: entry.id,
      name,
      quantity,
      currency,
      recurring: false,
      unitAmount,
      description: mapping.descriptionField ? str(data[mapping.descriptionField]) : undefined,
      image: mapping.imageField ? resolveImage(ctx, data[mapping.imageField]) : undefined,
    });
  }

  const currencies = new Set(items.map((i) => i.currency));
  if (currencies.size > 1) return fail("mixed_currencies", [...currencies].join(","));
  return { items };
}

/** Compact metadata describing what was bought, for webhooks and host apps. */
function itemsMetadata(items: ResolvedItem[]): { emdash_items: string; emdash_desc: string } {
  let json = JSON.stringify(items.map((i) => ({ c: i.collection, id: i.entryId, q: i.quantity })));
  if (json.length > 500) {
    json = JSON.stringify(items.map((i) => ({ id: i.entryId, q: i.quantity })));
  }
  if (json.length > 500) json = JSON.stringify({ count: items.length });
  const desc = items
    .map((i) => (i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name))
    .join(", ")
    .slice(0, 200);
  return { emdash_items: json, emdash_desc: desc };
}

// --- checkout (Checkout Sessions) ------------------------------------------------
async function handleCheckout(routeCtx: SandboxedRouteContext, ctx: PluginContext) {
  const cfg = await loadSettings(ctx);
  if (!cfg.secretKey) return fail("not_configured");
  if (!ctx.content) return fail("content_unavailable");
  const body = (routeCtx.input ?? {}) as Record<string, unknown>;
  const stripe = getStripe(cfg.secretKey);

  const resolved = await resolveItems(ctx, stripe, cfg, body.items);
  if ("error" in resolved) return resolved;
  const items = resolved.items;

  const anyRecurring = items.some((i) => i.recurring);
  let mode: "payment" | "subscription";
  if (body.mode === "payment" || body.mode === "subscription") {
    mode = body.mode;
    if (mode === "payment" && anyRecurring) return fail("recurring_requires_subscription");
  } else {
    mode = anyRecurring ? "subscription" : "payment";
  }

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = items.map((i) =>
    i.priceId
      ? { price: i.priceId, quantity: i.quantity }
      : {
          quantity: i.quantity,
          price_data: {
            currency: i.currency,
            unit_amount: i.unitAmount!,
            product_data: {
              name: i.name,
              ...(i.description ? { description: i.description } : {}),
              ...(i.image ? { images: [i.image] } : {}),
            },
          },
        },
  );

  const metadata = { source: METADATA_SOURCE, ...itemsMetadata(items), ...sanitizeMetadata(body.metadata) };
  const params: Stripe.Checkout.SessionCreateParams = { mode, line_items: lineItems, metadata };

  const customerEmail = str(body.customerEmail);
  if (customerEmail && EMAIL_RE.test(customerEmail)) params.customer_email = customerEmail;
  const clientReference = str(body.clientReference);
  if (clientReference && /^[\w.-]{1,200}$/.test(clientReference)) {
    params.client_reference_id = clientReference;
  }
  if (cfg.allowPromotionCodes) params.allow_promotion_codes = true;
  if (cfg.automaticTax) params.automatic_tax = { enabled: true };
  if (cfg.collectPhone) params.phone_number_collection = { enabled: true };
  if (cfg.shippingCountries.length > 0) {
    params.shipping_address_collection = {
      allowed_countries:
        cfg.shippingCountries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[],
    };
  }
  // Propagate metadata to the Subscription so subscription webhook events can
  // be traced back to CMS entries. (Not done for PaymentIntents on purpose:
  // session-created PIs are recorded via their session, and marking them
  // would double-record.)
  if (mode === "subscription") params.subscription_data = { metadata };

  // Stripe requires absolute URLs; ctx.url() resolves against the site origin.
  const embedded = body.uiMode === "embedded" || body.uiMode === "embedded_page";
  if (embedded) {
    params.ui_mode = "embedded_page";
    const returnPath = relPath(body.returnPath) ?? relPath(body.successPath) ?? cfg.successPath;
    params.return_url = withSessionParam(ctx.url(returnPath));
  } else {
    params.success_url = withSessionParam(ctx.url(relPath(body.successPath) ?? cfg.successPath));
    params.cancel_url = ctx.url(relPath(body.cancelPath) ?? cfg.cancelPath);
  }

  try {
    const session = await stripe.checkout.sessions.create(params);
    return embedded
      ? { ok: true, id: session.id, clientSecret: session.client_secret }
      : { ok: true, id: session.id, url: session.url };
  } catch (err) {
    ctx.log.error("Failed to create checkout session", err as Error);
    return fail("stripe_error", (err as Error).message);
  }
}

// --- payment-intent (custom payment UIs) -----------------------------------------
async function handlePaymentIntent(routeCtx: SandboxedRouteContext, ctx: PluginContext) {
  const cfg = await loadSettings(ctx);
  if (!cfg.secretKey) return fail("not_configured");
  if (!ctx.content) return fail("content_unavailable");
  const body = (routeCtx.input ?? {}) as Record<string, unknown>;
  const stripe = getStripe(cfg.secretKey);

  const resolved = await resolveItems(ctx, stripe, cfg, body.items);
  if ("error" in resolved) return resolved;
  const items = resolved.items;

  if (items.some((i) => i.recurring)) return fail("recurring_not_supported");
  if (items.some((i) => i.unitAmount == null)) return fail("unsupported_price");

  const amount = items.reduce((sum, i) => sum + i.unitAmount! * i.quantity, 0);
  if (amount <= 0) return fail("invalid_amount");
  const currency = items[0]!.currency;
  const meta = itemsMetadata(items);
  const description = str(body.description)?.slice(0, 500) ?? meta.emdash_desc;

  const params: Stripe.PaymentIntentCreateParams = {
    amount,
    currency,
    description,
    metadata: { source: METADATA_SOURCE, ...meta, ...sanitizeMetadata(body.metadata) },
    automatic_payment_methods: { enabled: true },
  };
  const receiptEmail = str(body.receiptEmail);
  if (receiptEmail && EMAIL_RE.test(receiptEmail)) params.receipt_email = receiptEmail;

  try {
    const pi = await stripe.paymentIntents.create(params);
    return { ok: true, id: pi.id, clientSecret: pi.client_secret, amount, currency };
  } catch (err) {
    ctx.log.error("Failed to create payment intent", err as Error);
    return fail("stripe_error", (err as Error).message);
  }
}

// --- session status (success pages) ----------------------------------------------
async function handleSession(routeCtx: SandboxedRouteContext, ctx: PluginContext) {
  const cfg = await loadSettings(ctx);
  if (!cfg.secretKey) return fail("not_configured");
  const body = (routeCtx.input ?? {}) as Record<string, unknown>;
  const sessionId = str(body.sessionId);
  if (!sessionId || !SESSION_ID_RE.test(sessionId)) return fail("invalid_session_id");
  try {
    const s = await getStripe(cfg.secretKey).checkout.sessions.retrieve(sessionId);
    return {
      ok: true,
      id: s.id,
      status: s.status,
      paymentStatus: s.payment_status,
      mode: s.mode,
      amountTotal: s.amount_total,
      currency: s.currency,
      customerEmail: s.customer_details?.email ?? null,
      clientReferenceId: s.client_reference_id ?? null,
    };
  } catch (err) {
    ctx.log.error("Failed to retrieve checkout session", err as Error);
    return fail("stripe_error");
  }
}

// --- public config -----------------------------------------------------------------
async function handleConfig(_routeCtx: SandboxedRouteContext, ctx: PluginContext) {
  const cfg = await loadSettings(ctx);
  return {
    ok: true,
    publishableKey: cfg.publishableKey,
    currency: cfg.currency,
    collections: cfg.mappings.map((m) => m.collection),
    successPath: cfg.successPath,
    cancelPath: cfg.cancelPath,
  };
}

// --- payment records ---------------------------------------------------------------
export interface PaymentRecord {
  objectType: string;
  status: string;
  amount: number | null;
  currency: string | null;
  email: string | null;
  customerName: string | null;
  description: string | null;
  mode: string | null;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  items: string | null;
  refundedAmount: number | null;
  lastEventType: string;
  lastEventId: string;
  stripeCreatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

async function upsertPayment(
  ctx: PluginContext,
  id: string,
  patch: Partial<PaymentRecord>,
): Promise<PaymentRecord> {
  const store = ctx.storage.payments!;
  const existing = (await store.get(id)) as PaymentRecord | null;
  const now = new Date().toISOString();
  const record: PaymentRecord = {
    objectType: "",
    status: "",
    amount: null,
    currency: null,
    email: null,
    customerName: null,
    description: null,
    mode: null,
    paymentIntentId: null,
    subscriptionId: null,
    items: null,
    refundedAmount: null,
    lastEventType: "",
    lastEventId: "",
    stripeCreatedAt: null,
    ...(existing ?? {}),
    ...patch,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await store.put(id, record);
  return record;
}

/**
 * Optionally mirror a paid record as a CMS order entry (setting: "Orders
 * collection"). The collection must define the documented field contract —
 * see README. Deduplicated via a KV marker so `checkout.session.completed`
 * and `checkout.session.async_payment_succeeded` don't create two orders.
 */
async function maybeCreateOrder(
  ctx: PluginContext,
  cfg: Settings,
  recordId: string,
  record: PaymentRecord,
): Promise<void> {
  if (!cfg.ordersCollection || record.status !== "paid") return;
  if (!ctx.content?.create) {
    ctx.log.warn("Orders collection is configured but the content:write capability is unavailable");
    return;
  }
  const markerKey = `state:order:${recordId}`;
  if (await ctx.kv.get(markerKey)) return;
  try {
    const entry = await ctx.content.create(cfg.ordersCollection, {
      title: `Order ${recordId.slice(-8).toUpperCase()}`,
      stripeId: recordId,
      paymentIntentId: record.paymentIntentId ?? "",
      amount: record.amount ?? 0,
      currency: record.currency ?? "",
      email: record.email ?? "",
      customerName: record.customerName ?? "",
      status: "paid",
      items: record.items ?? "",
    });
    await ctx.kv.set(markerKey, { entryId: entry.id, at: new Date().toISOString() });
  } catch (err) {
    ctx.log.error(
      `Failed to create an order entry in "${cfg.ordersCollection}" — does the collection exist with the documented fields?`,
      err as Error,
    );
  }
}

/** Forward a verified event to the host URL as an HMAC-signed POST. Best-effort. */
async function forwardEvent(ctx: PluginContext, cfg: Settings, event: Stripe.Event): Promise<void> {
  if (!cfg.forwardUrl || !cfg.forwardSecret) return;
  try {
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const signature = await hmacSha256Hex(cfg.forwardSecret, `${t}.${body}`);
    const res = await fetch(cfg.forwardUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-emdash-stripe-signature": `t=${t},v1=${signature}`,
      },
      body,
    });
    if (!res.ok) ctx.log.warn(`Event forward returned HTTP ${res.status}`, { eventId: event.id });
  } catch (err) {
    ctx.log.error("Event forward failed", err as Error);
  }
}

async function processEvent(ctx: PluginContext, cfg: Settings, event: Stripe.Event): Promise<void> {
  const type = event.type;

  if (type.startsWith("checkout.session.")) {
    const s = event.data.object as Stripe.Checkout.Session;
    let status: string;
    if (type === "checkout.session.completed") {
      status = s.payment_status !== "unpaid" ? "paid" : "pending";
    } else if (type === "checkout.session.async_payment_succeeded") status = "paid";
    else if (type === "checkout.session.async_payment_failed") status = "failed";
    else if (type === "checkout.session.expired") status = "expired";
    else return;

    const piId = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null);
    const record = await upsertPayment(ctx, s.id, {
      objectType: "checkout_session",
      status,
      amount: s.amount_total,
      currency: s.currency,
      email: s.customer_details?.email ?? s.customer_email ?? null,
      customerName: s.customer_details?.name ?? null,
      description: s.metadata?.emdash_desc ?? null,
      mode: s.mode,
      paymentIntentId: piId,
      items: s.metadata?.emdash_items ?? null,
      stripeCreatedAt: new Date(s.created * 1000).toISOString(),
      lastEventType: type,
      lastEventId: event.id,
    });
    // Alias so charge.refunded (which only knows the PI) can find this record.
    if (piId) await ctx.kv.set(`state:pi:${piId}`, s.id);
    if (s.metadata?.source === METADATA_SOURCE) await maybeCreateOrder(ctx, cfg, s.id, record);
    return;
  }

  if (type === "payment_intent.succeeded" || type === "payment_intent.payment_failed") {
    const pi = event.data.object as Stripe.PaymentIntent;
    // Only PIs created by this plugin's payment-intent route: PIs behind a
    // Checkout Session are recorded via their session events instead.
    if (pi.metadata?.source !== METADATA_SOURCE) return;
    const status = type === "payment_intent.succeeded" ? "paid" : "failed";
    const record = await upsertPayment(ctx, pi.id, {
      objectType: "payment_intent",
      status,
      amount: pi.amount,
      currency: pi.currency,
      email: pi.receipt_email ?? null,
      customerName: pi.shipping?.name ?? null,
      description: pi.description ?? pi.metadata?.emdash_desc ?? null,
      mode: "payment",
      paymentIntentId: pi.id,
      items: pi.metadata?.emdash_items ?? null,
      stripeCreatedAt: new Date(pi.created * 1000).toISOString(),
      lastEventType: type,
      lastEventId: event.id,
    });
    await maybeCreateOrder(ctx, cfg, pi.id, record);
    return;
  }

  if (type === "charge.refunded") {
    const ch = event.data.object as Stripe.Charge;
    const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : (ch.payment_intent?.id ?? null);
    if (!piId) return;
    const recordId = (await ctx.kv.get<string>(`state:pi:${piId}`)) ?? piId;
    const existing = (await ctx.storage.payments!.get(recordId)) as PaymentRecord | null;
    await upsertPayment(ctx, recordId, {
      status: ch.refunded ? "refunded" : "partially_refunded",
      refundedAmount: ch.amount_refunded,
      ...(existing
        ? {}
        : {
            objectType: "payment_intent",
            amount: ch.amount,
            currency: ch.currency,
            email: ch.billing_details?.email ?? null,
            customerName: ch.billing_details?.name ?? null,
            description: ch.description ?? null,
            paymentIntentId: piId,
            stripeCreatedAt: new Date(ch.created * 1000).toISOString(),
          }),
      lastEventType: type,
      lastEventId: event.id,
    });
    return;
  }

  if (type.startsWith("customer.subscription.")) {
    if (
      type !== "customer.subscription.created" &&
      type !== "customer.subscription.updated" &&
      type !== "customer.subscription.deleted"
    ) {
      return;
    }
    const sub = event.data.object as Stripe.Subscription;
    const item = sub.items?.data?.[0];
    const unit = item?.price?.unit_amount ?? null;
    await upsertPayment(ctx, sub.id, {
      objectType: "subscription",
      status: type === "customer.subscription.deleted" ? "canceled" : sub.status,
      amount: unit != null ? unit * (item?.quantity ?? 1) : null,
      currency: sub.currency ?? item?.price?.currency ?? null,
      description: sub.metadata?.emdash_desc ?? item?.price?.nickname ?? null,
      mode: "subscription",
      subscriptionId: sub.id,
      items: sub.metadata?.emdash_items ?? null,
      stripeCreatedAt: new Date(sub.created * 1000).toISOString(),
      lastEventType: type,
      lastEventId: event.id,
    });
    return;
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const inv = event.data.object as Stripe.Invoice;
    if (!inv.id) return;
    // The subscription reference moved from `invoice.subscription` to
    // `invoice.parent.subscription_details.subscription` in newer Stripe API
    // versions; read both shapes defensively.
    const invLoose = inv as unknown as Record<string, unknown>;
    let subscriptionId: string | null =
      typeof invLoose.subscription === "string" ? invLoose.subscription : null;
    if (!subscriptionId) {
      const parent = invLoose.parent as Record<string, unknown> | null | undefined;
      const details = parent?.subscription_details as Record<string, unknown> | undefined;
      if (details && typeof details.subscription === "string") {
        subscriptionId = details.subscription;
      }
    }
    await upsertPayment(ctx, inv.id, {
      objectType: "invoice",
      status: type === "invoice.paid" ? "paid" : "failed",
      amount: inv.amount_paid || inv.amount_due || null,
      currency: inv.currency ?? null,
      email: inv.customer_email ?? null,
      customerName: inv.customer_name ?? null,
      subscriptionId,
      stripeCreatedAt: new Date(inv.created * 1000).toISOString(),
      lastEventType: type,
      lastEventId: event.id,
    });
    return;
  }
  // Any other event type: verified and forwarded, but not recorded.
}

// --- webhook -------------------------------------------------------------------
async function handleWebhook(routeCtx: SandboxedRouteContext, ctx: PluginContext) {
  const input = (routeCtx.input ?? {}) as Record<string, unknown>;
  const id = typeof input.id === "string" ? input.id : "";
  if (!EVENT_ID_RE.test(id)) return { received: false, error: "invalid_event" };

  const cfg = await loadSettings(ctx);
  if (!cfg.secretKey) return { received: false, error: "not_configured" };

  const dedupKey = `state:evt:${id}`;
  if (await ctx.kv.get(dedupKey)) return { received: true, duplicate: true };

  const stripe = getStripe(cfg.secretKey);
  let event: Stripe.Event;
  try {
    event = await stripe.events.retrieve(id);
  } catch (err) {
    // Unknown to Stripe (forged, wrong account, or live/test mismatch) or a
    // transient API failure. Throw so the delivery is not acknowledged and
    // Stripe retries genuine events later.
    ctx.log.warn(`Webhook event ${id} could not be verified against the Stripe API`, {
      message: (err as Error).message,
    });
    throw new Error("event_verification_failed");
  }

  await processEvent(ctx, cfg, event);
  await ctx.kv.set(dedupKey, { type: event.type, at: new Date().toISOString() });
  await forwardEvent(ctx, cfg, event);
  return { received: true, type: event.type };
}

export default {
  routes: {
    checkout: { public: true, handler: handleCheckout },
    "payment-intent": { public: true, handler: handlePaymentIntent },
    session: { public: true, handler: handleSession },
    config: { public: true, handler: handleConfig },
    webhook: { public: true, handler: handleWebhook },
    admin: { handler: handleAdmin },
  },
} satisfies SandboxedPlugin;
