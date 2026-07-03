/**
 * Runtime settings for emdash-stripe.
 *
 * Everything is configured from the admin settings page and stored in the
 * plugin KV (standard-format plugins do not receive descriptor options in the
 * entrypoint). The Stripe API keys may alternatively come from the host
 * Worker env — `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` — which is the
 * recommended place for the secret key in production (wrangler secrets). A
 * key saved in the settings page takes precedence, so a bad key can always be
 * fixed from the admin UI.
 */

import type { PluginContext } from "emdash/plugin";
import { env as cfEnv } from "cloudflare:workers";
import { normalizeLang, DEFAULT_LANG, type Lang } from "./i18n.js";

// --- KV keys -----------------------------------------------------------------
export const K = {
  language: "settings:language",
  secretKey: "settings:secretKey",
  publishableKey: "settings:publishableKey",
  currency: "settings:currency",
  priceUnit: "settings:priceUnit",
  mappings: "settings:mappings",
  successPath: "settings:successPath",
  cancelPath: "settings:cancelPath",
  allowPromotionCodes: "settings:allowPromotionCodes",
  automaticTax: "settings:automaticTax",
  collectPhone: "settings:collectPhone",
  shippingCountries: "settings:shippingCountries",
  ordersCollection: "settings:ordersCollection",
  forwardUrl: "settings:forwardUrl",
  forwardSecret: "settings:forwardSecret",
} as const;

// --- collection mappings -------------------------------------------------------
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
export interface CollectionMapping {
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
}

export const DEFAULT_MAPPINGS: CollectionMapping[] = [
  { collection: "products", priceField: "price", priceIdField: "stripePriceId", nameField: "name" },
];

/** Parse the mappings JSON from settings; malformed input falls back to the default. */
export function parseMappings(raw: string): CollectionMapping[] {
  if (!raw.trim()) return DEFAULT_MAPPINGS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_MAPPINGS;
    const mappings: CollectionMapping[] = [];
    for (const m of parsed) {
      if (!m || typeof m !== "object" || typeof m.collection !== "string" || !m.collection) {
        return DEFAULT_MAPPINGS;
      }
      const str = (v: unknown): string | undefined =>
        typeof v === "string" && v.trim() ? v.trim() : undefined;
      mappings.push({
        collection: m.collection,
        priceField: str(m.priceField) ?? "price",
        priceIdField: str(m.priceIdField) ?? "stripePriceId",
        nameField: str(m.nameField) ?? "name",
        descriptionField: str(m.descriptionField),
        imageField: str(m.imageField),
        currencyField: str(m.currencyField),
      });
    }
    return mappings;
  } catch {
    return DEFAULT_MAPPINGS;
  }
}

/** Validate raw mappings JSON for the settings form (stricter than the lenient parse). */
export function isValidMappingsJson(raw: string): boolean {
  if (!raw.trim()) return true;
  try {
    const parsed = JSON.parse(raw);
    return (
      Array.isArray(parsed) &&
      parsed.every(
        (m) => m && typeof m === "object" && typeof m.collection === "string" && m.collection,
      )
    );
  } catch {
    return false;
  }
}

// --- settings ------------------------------------------------------------------
export interface Settings {
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
  /** Two-letter ISO country codes; empty = don't collect a shipping address. */
  shippingCountries: string[];
  /** Collection slug for order entries on successful payment; empty = disabled. */
  ordersCollection: string;
  /** URL receiving signed copies of verified webhook events; empty = disabled. */
  forwardUrl: string;
  forwardSecret: string;
}

function envStr(name: string): string {
  const env = cfEnv as unknown as Record<string, unknown>;
  const v = env[name];
  return typeof v === "string" ? v : "";
}

export async function getStr(ctx: PluginContext, key: string, def = ""): Promise<string> {
  const v = await ctx.kv.get<string>(key);
  return typeof v === "string" && v.length > 0 ? v : def;
}

function sanitizePath(p: string, def: string): string {
  const s = p.trim();
  return s.startsWith("/") && !s.startsWith("//") ? s : def;
}

function splitCountries(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
}

export async function loadSettings(ctx: PluginContext): Promise<Settings> {
  const lang = normalizeLang(await getStr(ctx, K.language, DEFAULT_LANG));
  return {
    lang,
    secretKey: (await getStr(ctx, K.secretKey)) || envStr("STRIPE_SECRET_KEY"),
    publishableKey: (await getStr(ctx, K.publishableKey)) || envStr("STRIPE_PUBLISHABLE_KEY"),
    currency: (await getStr(ctx, K.currency, "usd")).toLowerCase(),
    priceUnit: (await getStr(ctx, K.priceUnit)) === "minor" ? "minor" : "major",
    mappings: parseMappings(await getStr(ctx, K.mappings)),
    successPath: sanitizePath(await getStr(ctx, K.successPath), "/checkout/success"),
    cancelPath: sanitizePath(await getStr(ctx, K.cancelPath), "/checkout/cancel"),
    allowPromotionCodes: (await getStr(ctx, K.allowPromotionCodes)) === "1",
    automaticTax: (await getStr(ctx, K.automaticTax)) === "1",
    collectPhone: (await getStr(ctx, K.collectPhone)) === "1",
    shippingCountries: splitCountries(await getStr(ctx, K.shippingCountries)),
    ordersCollection: (await getStr(ctx, K.ordersCollection)).trim(),
    forwardUrl: (await getStr(ctx, K.forwardUrl)).trim(),
    forwardSecret: await getStr(ctx, K.forwardSecret),
  };
}
