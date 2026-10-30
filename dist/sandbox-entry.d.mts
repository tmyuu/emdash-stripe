import * as _$emdash_plugin0 from "emdash/plugin";
import { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import Stripe from "stripe";

//#region src/i18n.d.ts
/**
 * i18n for emdash-stripe.
 *
 * All admin-facing strings live here, keyed by language. Application code must
 * NOT hard-code any human-readable text — it reads everything from the active
 * locale returned by `getLocale(lang)`. Add a new language by adding an entry
 * to `LOCALES` (and to `LANGS`).
 *
 * The active language is a runtime setting (admin settings page → "Language")
 * stored in the plugin KV. It drives the admin UI, the `message` field on
 * route error responses (machine `error` codes stay stable), and — for `ja` —
 * pins the Stripe Checkout session locale.
 */
type Lang = "en" | "ja";
//#endregion
//#region src/config.d.ts
/**
 * Declares one EmDash collection as sellable and maps its fields. Every field
 * except `collection` has a sensible default; a bare `{"collection": "x"}` is
 * a valid mapping.
 *
 * Per entry, `priceIdField` (a Stripe Price ID, `price_...`) wins over
 * `priceField` (a number charged via inline `price_data`). Stripe Prices are
 * the path to subscriptions; numeric prices keep the CMS as the single source
 * of truth with zero Stripe catalog management.
 */
interface CollectionMapping {
  collection: string;
  /** Field holding a numeric price. Default: "price". */
  priceField: string;
  /** Field holding a Stripe Price ID. Default: "stripePriceId". */
  priceIdField: string;
  /** Field holding the display name. Default: "name" (falls back to "title", slug, id). */
  nameField: string;
  /** Optional field holding a short description passed to Stripe. */
  descriptionField?: string;
  /** Optional field holding an image (absolute URL, site-relative path, or media object with `url`). */
  imageField?: string;
  /** Optional field holding a per-entry ISO currency code overriding the default. */
  currencyField?: string;
  /** Optional gate: when set, the entry's value here must be truthy to sell as recurring. */
  recurringEnabledField?: string;
  /** Field holding the recurring price. Falls back to `priceField`. */
  recurringPriceField?: string;
  /** Field holding the billing interval ("day"|"week"|"month"|"year"). */
  recurringIntervalField?: string;
  /** Fixed billing interval when no field is set. Default: "month". */
  recurringInterval?: RecurringInterval;
  /** Field holding the interval count (e.g. 4 = every 4 months). */
  recurringIntervalCountField?: string;
  /** Fixed interval count when no field is set. Default: 1. */
  recurringIntervalCount?: number;
  /** Display-name template for recurring line items: `{name}`, `{count}`, `{interval}`. Default: `{name}`. */
  recurringNameTemplate?: string;
}
type RecurringInterval = "day" | "week" | "month" | "year";
interface Settings {
  lang: Lang;
  secretKey: string;
  publishableKey: string;
  /**
   * Webhook endpoint signing secret (`whsec_...`). Set = deliveries are
   * verified by signature; empty = each event is re-fetched from the API.
   */
  webhookSecret: string;
  /** Default ISO currency code (lowercase), e.g. "usd". */
  currency: string;
  /** How numeric price fields are interpreted. */
  priceUnit: "major" | "minor";
  mappings: CollectionMapping[];
  successPath: string;
  cancelPath: string;
  allowPromotionCodes: boolean;
  automaticTax: boolean;
  collectPhone: boolean;
  /** Ask for marketing-email consent on hosted checkout (consent_collection.promotions). */
  consentPromotions: boolean;
  /** Keep expired hosted checkouts recoverable (after_expiration.recovery). */
  recoveryEnabled: boolean;
  /** Two-letter ISO country codes; empty = don't collect a shipping address. */
  shippingCountries: string[];
  /** Collection slug for order entries on successful payment; empty = disabled. */
  ordersCollection: string;
  /** URL receiving signed copies of verified webhook events; empty = disabled. */
  forwardUrl: string;
  forwardSecret: string;
  /**
   * Service binding name to send forwards through. Required when the forward
   * URL is the host Worker itself — Cloudflare blocks a Worker from fetching
   * its own hostname. Empty = global fetch (forwarding to another origin).
   */
  forwardBinding: string;
}
//#endregion
//#region src/admin.d.ts
declare function handleAdmin(routeCtx: SandboxedRouteContext, ctx: PluginContext): Promise<{
  blocks: ({
    type: string;
    text: string;
    blockId?: undefined;
    columns?: undefined;
    rows?: undefined;
  } | {
    type: string;
    blockId: string;
    columns: {
      key: string;
      label: string;
      format: string;
    }[];
    rows: Record<string, unknown>[];
    text?: undefined;
  })[];
} | {
  blocks: ({
    type: string;
    text: string;
    submit?: undefined;
    fields?: undefined;
  } | {
    type: string;
    submit: {
      label: string;
      action_id: string;
    };
    fields: ({
      type: string;
      action_id: string;
      label: string;
      initial_value: Lang;
      options: {
        value: Lang;
        label: string;
      }[];
      placeholder?: undefined;
      multiline?: undefined;
    } | {
      type: string;
      action_id: string;
      label: string;
      placeholder: string;
      initial_value?: undefined;
      options?: undefined;
      multiline?: undefined;
    } | {
      type: string;
      action_id: string;
      label: string;
      placeholder: string;
      initial_value: string;
      options?: undefined;
      multiline?: undefined;
    } | {
      type: string;
      action_id: string;
      label: string;
      initial_value: boolean;
      options?: undefined;
      placeholder?: undefined;
      multiline?: undefined;
    } | {
      type: string;
      action_id: string;
      label: string;
      initial_value: "major" | "minor";
      options: {
        value: string;
        label: string;
      }[];
      placeholder?: undefined;
      multiline?: undefined;
    } | {
      type: string;
      action_id: string;
      label: string;
      placeholder: string;
      multiline: boolean;
      initial_value: string;
      options?: undefined;
    })[];
    text?: undefined;
  })[];
}>;
//#endregion
//#region src/sandbox-entry.d.ts
/**
 * Fields only the host application may set (they act on someone's Stripe
 * Customer), carried as a `trusted` token the host signs with the shared
 * forwarding secret. A public caller cannot mint one.
 */
interface TrustedFields {
  customer?: string;
  setupFutureUsage?: "on_session" | "off_session";
}
type TrustedResult = {
  trusted: TrustedFields;
} | {
  ok: false;
  error: string;
};
/** (exported for tests) */
declare function resolveTrusted(cfg: Settings, body: Record<string, unknown>): Promise<TrustedResult>;
/** Client-supplied metadata: string→string, capped, reserved keys stripped. (exported for tests) */
declare function sanitizeMetadata(v: unknown): Record<string, string>;
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
  /** Billing cadence for recurring price_data items. */
  interval?: RecurringInterval;
  intervalCount?: number;
  description?: string;
  image?: string;
}
/** Display name for a recurring line item from the mapping's template. (exported for tests) */
declare function renderRecurringName(template: string | undefined, name: string, count: number, interval: RecurringInterval): string;
/** Compact metadata describing what was bought, for webhooks and host apps. (exported for tests) */
declare function itemsMetadata(items: ResolvedItem[]): {
  emdash_items: string;
  emdash_desc: string;
};
declare function handleConfig(_routeCtx: SandboxedRouteContext, ctx: PluginContext): Promise<{
  ok: boolean;
  publishableKey: string;
  currency: string;
  collections: string[];
  successPath: string;
  cancelPath: string;
}>;
interface PaymentRecord {
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
/**
 * Amount per billing period across all subscription items, or null when an
 * item has no fixed unit amount (e.g. tiered/metered) or currencies differ.
 * (exported for tests)
 */
declare function subscriptionAmount(sub: Stripe.Subscription): number | null;
/** (exported for tests) */
declare function handleWebhook(routeCtx: SandboxedRouteContext, ctx: PluginContext): Promise<_$emdash_plugin0.PluginResponse>;
declare const _default: {
  routes: {
    checkout: {
      public: true;
      handler: (routeCtx: SandboxedRouteContext, ctx: PluginContext) => Promise<unknown>;
    };
    "payment-intent": {
      public: true;
      handler: (routeCtx: SandboxedRouteContext, ctx: PluginContext) => Promise<unknown>;
    };
    subscription: {
      public: true;
      handler: (routeCtx: SandboxedRouteContext, ctx: PluginContext) => Promise<unknown>;
    };
    session: {
      public: true;
      handler: (routeCtx: SandboxedRouteContext, ctx: PluginContext) => Promise<unknown>;
    };
    config: {
      public: true;
      handler: typeof handleConfig;
    };
    webhook: {
      public: true;
      methods: "POST"[];
      request: {
        body: "text";
        headers: string[];
      };
      response: "raw";
      handler: typeof handleWebhook;
    };
    admin: {
      handler: typeof handleAdmin;
    };
  };
};
//#endregion
export { PaymentRecord, _default as default, handleWebhook, itemsMetadata, renderRecurringName, resolveTrusted, sanitizeMetadata, subscriptionAmount };