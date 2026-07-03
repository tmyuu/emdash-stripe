import { PluginContext, SandboxedRouteContext } from "emdash/plugin";

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
    } | {
      type: string;
      action_id: string;
      label: string;
      initial_value: boolean;
      options?: undefined;
      placeholder?: undefined;
      multiline?: undefined;
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
declare function handleWebhook(routeCtx: SandboxedRouteContext, ctx: PluginContext): Promise<{
  received: boolean;
  error: string;
  duplicate?: undefined;
  type?: undefined;
} | {
  received: boolean;
  duplicate: boolean;
  error?: undefined;
  type?: undefined;
} | {
  received: boolean;
  type: "account.application.deauthorized" | "account.application.authorized" | "account.external_account.created" | "account.external_account.deleted" | "account.external_account.updated" | "account.updated" | "application_fee.created" | "application_fee.refund.updated" | "application_fee.refunded" | "balance.available" | "balance_settings.updated" | "billing.alert.triggered" | "billing.credit_balance_transaction.created" | "billing.credit_grant.created" | "billing.credit_grant.updated" | "billing.meter.created" | "billing.meter.deactivated" | "billing.meter.reactivated" | "billing.meter.updated" | "billing_portal.configuration.created" | "billing_portal.configuration.updated" | "billing_portal.session.created" | "capability.updated" | "cash_balance.funds_available" | "charge.captured" | "charge.dispute.closed" | "charge.dispute.created" | "charge.dispute.funds_reinstated" | "charge.dispute.funds_withdrawn" | "charge.dispute.updated" | "charge.expired" | "charge.failed" | "charge.pending" | "charge.refund.updated" | "charge.refunded" | "charge.succeeded" | "charge.updated" | "checkout.session.async_payment_failed" | "checkout.session.async_payment_succeeded" | "checkout.session.completed" | "checkout.session.expired" | "climate.order.canceled" | "climate.order.created" | "climate.order.delayed" | "climate.order.delivered" | "climate.order.product_substituted" | "climate.product.created" | "climate.product.pricing_updated" | "coupon.created" | "coupon.deleted" | "coupon.updated" | "credit_note.created" | "credit_note.updated" | "credit_note.voided" | "customer.created" | "customer.deleted" | "customer.discount.created" | "customer.discount.deleted" | "customer.discount.updated" | "customer.source.created" | "customer.source.deleted" | "customer.source.expiring" | "customer.source.updated" | "customer.subscription.created" | "customer.subscription.deleted" | "customer.subscription.paused" | "customer.subscription.pending_update_applied" | "customer.subscription.pending_update_expired" | "customer.subscription.resumed" | "customer.subscription.trial_will_end" | "customer.subscription.updated" | "customer.tax_id.created" | "customer.tax_id.deleted" | "customer.tax_id.updated" | "customer.updated" | "customer_cash_balance_transaction.created" | "entitlements.active_entitlement_summary.updated" | "file.created" | "financial_connections.account.account_numbers_updated" | "financial_connections.account.created" | "financial_connections.account.deactivated" | "financial_connections.account.disconnected" | "financial_connections.account.reactivated" | "financial_connections.account.refreshed_balance" | "financial_connections.account.refreshed_ownership" | "financial_connections.account.refreshed_transactions" | "financial_connections.account.upcoming_account_number_expiry" | "identity.verification_session.canceled" | "identity.verification_session.created" | "identity.verification_session.processing" | "identity.verification_session.redacted" | "identity.verification_session.requires_input" | "identity.verification_session.verified" | "invoice.created" | "invoice.deleted" | "invoice.finalization_failed" | "invoice.finalized" | "invoice.marked_uncollectible" | "invoice.overdue" | "invoice.overpaid" | "invoice.paid" | "invoice.payment_action_required" | "invoice.payment_attempt_required" | "invoice.payment_failed" | "invoice.payment_succeeded" | "invoice.sent" | "invoice.upcoming" | "invoice.updated" | "invoice.voided" | "invoice.will_be_due" | "invoice_payment.paid" | "invoiceitem.created" | "invoiceitem.deleted" | "issuing_authorization.created" | "issuing_authorization.request" | "issuing_authorization.updated" | "issuing_card.created" | "issuing_card.updated" | "issuing_cardholder.created" | "issuing_cardholder.updated" | "issuing_dispute.closed" | "issuing_dispute.created" | "issuing_dispute.funds_reinstated" | "issuing_dispute.funds_rescinded" | "issuing_dispute.submitted" | "issuing_dispute.updated" | "issuing_personalization_design.activated" | "issuing_personalization_design.deactivated" | "issuing_personalization_design.rejected" | "issuing_personalization_design.updated" | "issuing_token.created" | "issuing_token.updated" | "issuing_transaction.created" | "issuing_transaction.purchase_details_receipt_updated" | "issuing_transaction.updated" | "mandate.updated" | "payment_intent.amount_capturable_updated" | "payment_intent.canceled" | "payment_intent.created" | "payment_intent.partially_funded" | "payment_intent.payment_failed" | "payment_intent.processing" | "payment_intent.requires_action" | "payment_intent.succeeded" | "payment_link.created" | "payment_link.updated" | "payment_method.attached" | "payment_method.automatically_updated" | "payment_method.detached" | "payment_method.updated" | "payout.canceled" | "payout.created" | "payout.failed" | "payout.paid" | "payout.reconciliation_completed" | "payout.updated" | "person.created" | "person.deleted" | "person.updated" | "plan.created" | "plan.deleted" | "plan.updated" | "price.created" | "price.deleted" | "price.updated" | "product.created" | "product.deleted" | "product.updated" | "promotion_code.created" | "promotion_code.updated" | "quote.accepted" | "quote.canceled" | "quote.created" | "quote.finalized" | "radar.early_fraud_warning.created" | "radar.early_fraud_warning.updated" | "refund.created" | "refund.failed" | "refund.updated" | "reporting.report_run.failed" | "reporting.report_run.succeeded" | "reporting.report_type.updated" | "reserve.hold.created" | "reserve.hold.updated" | "reserve.plan.created" | "reserve.plan.disabled" | "reserve.plan.expired" | "reserve.plan.updated" | "reserve.release.created" | "review.closed" | "review.opened" | "setup_intent.canceled" | "setup_intent.created" | "setup_intent.requires_action" | "setup_intent.setup_failed" | "setup_intent.succeeded" | "sigma.scheduled_query_run.created" | "source.canceled" | "source.chargeable" | "source.failed" | "source.mandate_notification" | "source.refund_attributes_required" | "source.transaction.created" | "source.transaction.updated" | "subscription_schedule.aborted" | "subscription_schedule.canceled" | "subscription_schedule.completed" | "subscription_schedule.created" | "subscription_schedule.expiring" | "subscription_schedule.released" | "subscription_schedule.updated" | "tax.settings.updated" | "tax_rate.created" | "tax_rate.updated" | "terminal.reader.action_failed" | "terminal.reader.action_succeeded" | "terminal.reader.action_updated" | "test_helpers.test_clock.advancing" | "test_helpers.test_clock.created" | "test_helpers.test_clock.deleted" | "test_helpers.test_clock.internal_failure" | "test_helpers.test_clock.ready" | "topup.canceled" | "topup.created" | "topup.failed" | "topup.reversed" | "topup.succeeded" | "transfer.created" | "transfer.reversed" | "transfer.updated" | "treasury.credit_reversal.created" | "treasury.credit_reversal.posted" | "treasury.debit_reversal.completed" | "treasury.debit_reversal.created" | "treasury.debit_reversal.initial_credit_granted" | "treasury.financial_account.closed" | "treasury.financial_account.created" | "treasury.financial_account.features_status_updated" | "treasury.inbound_transfer.canceled" | "treasury.inbound_transfer.created" | "treasury.inbound_transfer.failed" | "treasury.inbound_transfer.succeeded" | "treasury.outbound_payment.canceled" | "treasury.outbound_payment.created" | "treasury.outbound_payment.expected_arrival_date_updated" | "treasury.outbound_payment.failed" | "treasury.outbound_payment.posted" | "treasury.outbound_payment.returned" | "treasury.outbound_payment.tracking_details_updated" | "treasury.outbound_transfer.canceled" | "treasury.outbound_transfer.created" | "treasury.outbound_transfer.expected_arrival_date_updated" | "treasury.outbound_transfer.failed" | "treasury.outbound_transfer.posted" | "treasury.outbound_transfer.returned" | "treasury.outbound_transfer.tracking_details_updated" | "treasury.received_credit.created" | "treasury.received_credit.failed" | "treasury.received_credit.succeeded" | "treasury.received_debit.created";
  error?: undefined;
  duplicate?: undefined;
}>;
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
      handler: typeof handleWebhook;
    };
    admin: {
      handler: typeof handleAdmin;
    };
  };
};
//#endregion
export { PaymentRecord, _default as default, itemsMetadata, renderRecurringName, resolveTrusted, sanitizeMetadata };