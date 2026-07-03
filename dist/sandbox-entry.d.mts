import Stripe from "stripe";
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
 * stored in the plugin KV. It only affects the admin UI: the customer-facing
 * payment UI is Stripe Checkout itself, which localizes independently.
 */
type Lang = "en" | "ja";
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
declare function handleCheckout(routeCtx: SandboxedRouteContext, ctx: PluginContext): Promise<{
  ok: false;
  error: string;
  detail?: string;
} | {
  ok: boolean;
  id: string;
  clientSecret: string | null;
  url?: undefined;
} | {
  ok: boolean;
  id: string;
  url: string | null;
  clientSecret?: undefined;
}>;
declare function handlePaymentIntent(routeCtx: SandboxedRouteContext, ctx: PluginContext): Promise<{
  ok: false;
  error: string;
  detail?: string;
} | {
  ok: boolean;
  id: string;
  clientSecret: string | null;
  amount: number;
  currency: string;
}>;
declare function handleSession(routeCtx: SandboxedRouteContext, ctx: PluginContext): Promise<{
  ok: false;
  error: string;
  detail?: string;
} | {
  ok: boolean;
  id: string;
  status: Stripe.Checkout.Session.Status | null;
  paymentStatus: Stripe.Checkout.Session.PaymentStatus;
  mode: Stripe.Checkout.Session.Mode;
  amountTotal: number | null;
  currency: string | null;
  customerEmail: string | null;
  clientReferenceId: string | null;
}>;
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
      handler: typeof handleCheckout;
    };
    "payment-intent": {
      public: true;
      handler: typeof handlePaymentIntent;
    };
    session: {
      public: true;
      handler: typeof handleSession;
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
export { PaymentRecord, _default as default };