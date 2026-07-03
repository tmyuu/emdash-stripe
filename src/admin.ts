/**
 * Block Kit admin pages for emdash-stripe.
 *
 *   - `/settings` — API keys, currency, sellable-collection mappings, checkout
 *                   options, order mirroring, event forwarding. Also shows the
 *                   webhook endpoint URL to register in the Stripe Dashboard.
 *   - `/payments` — the most recent payment records collected from webhooks.
 *
 * All human-readable text comes from `src/i18n.ts`, selected by the runtime
 * "Language" setting (default English).
 */

import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import { getLocale, normalizeLang, DEFAULT_LANG, LANGS } from "./i18n.js";
import { K, loadSettings, isValidMappingsJson, getStr } from "./config.js";
import { formatAmount } from "./stripe.js";

async function buildSettingsPage(ctx: PluginContext) {
  const cfg = await loadSettings(ctx);
  const t = getLocale(cfg.lang).admin;
  const webhookUrl = ctx.url(`/_emdash/api/plugins/${ctx.plugin.id}/webhook`);
  const keyStatus = !cfg.secretKey
    ? t.keyStatusMissing
    : /^(sk|rk)_test_/.test(cfg.secretKey)
      ? t.keyStatusTest
      : t.keyStatusLive;
  return {
    blocks: [
      { type: "header", text: t.settingsTitle },
      { type: "section", text: t.settingsIntro },
      { type: "section", text: t.webhookInfo.replace("{url}", webhookUrl) },
      { type: "section", text: keyStatus },
      {
        type: "form",
        submit: { label: t.saveButton, action_id: "save_settings" },
        fields: [
          {
            type: "select",
            action_id: "language",
            label: t.languageFieldLabel,
            initial_value: cfg.lang,
            options: LANGS.map((l) => ({ value: l, label: getLocale(l).admin.languageOptionLabel })),
          },
          { type: "secret_input", action_id: "secretKey", label: t.secretKeyLabel, placeholder: t.secretKeyPlaceholder },
          { type: "text_input", action_id: "publishableKey", label: t.publishableKeyLabel, placeholder: t.publishableKeyPlaceholder, initial_value: (await getStr(ctx, K.publishableKey)) },
          { type: "text_input", action_id: "currency", label: t.currencyLabel, placeholder: t.currencyPlaceholder, initial_value: cfg.currency },
          {
            type: "select",
            action_id: "priceUnit",
            label: t.priceUnitLabel,
            initial_value: cfg.priceUnit,
            options: [
              { value: "major", label: t.priceUnitMajorOption },
              { value: "minor", label: t.priceUnitMinorOption },
            ],
          },
          { type: "text_input", action_id: "mappings", label: t.mappingsLabel, placeholder: t.mappingsPlaceholder, multiline: true, initial_value: JSON.stringify(cfg.mappings, null, 2) },
          { type: "text_input", action_id: "successPath", label: t.successPathLabel, placeholder: t.successPathPlaceholder, initial_value: cfg.successPath },
          { type: "text_input", action_id: "cancelPath", label: t.cancelPathLabel, placeholder: t.cancelPathPlaceholder, initial_value: cfg.cancelPath },
          { type: "toggle", action_id: "allowPromotionCodes", label: t.allowPromotionCodesLabel, initial_value: cfg.allowPromotionCodes },
          { type: "toggle", action_id: "automaticTax", label: t.automaticTaxLabel, initial_value: cfg.automaticTax },
          { type: "toggle", action_id: "collectPhone", label: t.collectPhoneLabel, initial_value: cfg.collectPhone },
          { type: "text_input", action_id: "shippingCountries", label: t.shippingCountriesLabel, placeholder: t.shippingCountriesPlaceholder, initial_value: cfg.shippingCountries.join(", ") },
          { type: "text_input", action_id: "ordersCollection", label: t.ordersCollectionLabel, placeholder: t.ordersCollectionPlaceholder, initial_value: cfg.ordersCollection },
          { type: "text_input", action_id: "forwardUrl", label: t.forwardUrlLabel, placeholder: t.forwardUrlPlaceholder, initial_value: cfg.forwardUrl },
          { type: "secret_input", action_id: "forwardSecret", label: t.forwardSecretLabel, placeholder: t.forwardSecretPlaceholder },
          { type: "text_input", action_id: "forwardBinding", label: t.forwardBindingLabel, placeholder: t.forwardBindingPlaceholder, initial_value: cfg.forwardBinding },
        ],
      },
    ],
  };
}

async function saveSettings(ctx: PluginContext, values: Record<string, unknown>) {
  // Persist the language first so validation errors and the re-rendered page
  // reflect the (possibly) newly selected language.
  if (typeof values.language === "string") {
    await ctx.kv.set(K.language, normalizeLang(values.language));
  }
  const t = getLocale(normalizeLang(await getStr(ctx, K.language, DEFAULT_LANG))).admin;
  try {
    if (typeof values.mappings === "string" && !isValidMappingsJson(values.mappings)) {
      return { ...(await buildSettingsPage(ctx)), toast: { message: t.toastInvalidMappings, type: "error" } };
    }
    const forwardUrl = typeof values.forwardUrl === "string" ? values.forwardUrl.trim() : "";
    if (forwardUrl && !/^https?:\/\//.test(forwardUrl)) {
      return { ...(await buildSettingsPage(ctx)), toast: { message: t.toastInvalidForwardUrl, type: "error" } };
    }
    for (const key of ["successPath", "cancelPath"] as const) {
      const v = typeof values[key] === "string" ? (values[key] as string).trim() : "";
      if (v && !v.startsWith("/")) {
        return { ...(await buildSettingsPage(ctx)), toast: { message: t.toastInvalidPath, type: "error" } };
      }
    }

    const setStr = async (key: string, v: unknown) => {
      const s = typeof v === "string" ? v.trim() : "";
      if (s) await ctx.kv.set(key, s);
      else await ctx.kv.delete(key);
    };
    await setStr(K.publishableKey, values.publishableKey);
    await setStr(K.currency, typeof values.currency === "string" ? values.currency.toLowerCase() : "");
    await setStr(K.priceUnit, values.priceUnit === "minor" ? "minor" : "");
    await setStr(K.mappings, values.mappings);
    await setStr(K.successPath, values.successPath);
    await setStr(K.cancelPath, values.cancelPath);
    await setStr(K.shippingCountries, values.shippingCountries);
    await setStr(K.ordersCollection, values.ordersCollection);
    await setStr(K.forwardUrl, values.forwardUrl);
    await setStr(K.forwardBinding, values.forwardBinding);
    // toggles → "1" / absent
    for (const [key, kvKey] of [
      ["allowPromotionCodes", K.allowPromotionCodes],
      ["automaticTax", K.automaticTax],
      ["collectPhone", K.collectPhone],
    ] as const) {
      if (values[key] === true) await ctx.kv.set(kvKey, "1");
      else await ctx.kv.delete(kvKey);
    }
    // secrets: only overwrite when a new value is entered (blank = keep)
    for (const [key, kvKey] of [
      ["secretKey", K.secretKey],
      ["forwardSecret", K.forwardSecret],
    ] as const) {
      const v = values[key];
      if (typeof v === "string" && v.trim()) await ctx.kv.set(kvKey, v.trim());
    }

    return { ...(await buildSettingsPage(ctx)), toast: { message: t.toastSaved, type: "success" } };
  } catch (err) {
    ctx.log.error("Failed to save Stripe settings", err as Error);
    return { ...(await buildSettingsPage(ctx)), toast: { message: t.toastSaveFailed, type: "error" } };
  }
}

async function buildPaymentsPage(ctx: PluginContext) {
  const cfg = await loadSettings(ctx);
  const t = getLocale(cfg.lang).admin;
  let rows: Array<Record<string, unknown>> = [];
  try {
    const result = await ctx.storage.payments!.query({ orderBy: { createdAt: "desc" }, limit: 100 });
    rows = (result.items ?? []).map((item: { id: string; data: unknown }) => {
      const d = (item.data ?? {}) as Record<string, unknown>;
      const amount = typeof d.amount === "number" ? d.amount : null;
      const currency = typeof d.currency === "string" ? d.currency : null;
      return {
        createdAt: d.createdAt ?? "",
        type: d.objectType ?? "",
        status: d.status ?? "",
        amount: amount != null && currency ? formatAmount(amount, currency) : "",
        email: d.email ?? "",
        description: d.description ?? "",
      };
    });
  } catch (err) {
    ctx.log.error("Failed to load payment records", err as Error);
  }
  return {
    blocks: [
      { type: "header", text: t.paymentsTitle },
      { type: "section", text: t.paymentsIntro },
      {
        type: "table",
        blockId: "payments-table",
        columns: [
          { key: "createdAt", label: t.colCreatedAt, format: "datetime" },
          { key: "type", label: t.colType, format: "text" },
          { key: "status", label: t.colStatus, format: "text" },
          { key: "amount", label: t.colAmount, format: "text" },
          { key: "email", label: t.colEmail, format: "text" },
          { key: "description", label: t.colDescription, format: "text" },
        ],
        rows,
      },
    ],
  };
}

type AdminInteraction = {
  type: "page_load" | "form_submit" | string;
  page?: string;
  action_id?: string;
  values?: Record<string, unknown>;
};

export async function handleAdmin(routeCtx: SandboxedRouteContext, ctx: PluginContext) {
  const it = routeCtx.input as AdminInteraction;
  if (it.type === "page_load" && it.page === "/payments") return buildPaymentsPage(ctx);
  if (it.type === "page_load") return buildSettingsPage(ctx);
  if (it.type === "form_submit" && it.action_id === "save_settings") return saveSettings(ctx, it.values ?? {});
  return { blocks: [] };
}
