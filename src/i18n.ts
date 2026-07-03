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

export type Lang = "en" | "ja";

/** Supported languages, in the order shown in the settings dropdown. */
export const LANGS: Lang[] = ["en", "ja"];

/** Default language when none has been configured. */
export const DEFAULT_LANG: Lang = "en";

export function isLang(v: unknown): v is Lang {
  return v === "en" || v === "ja";
}

export function normalizeLang(v: unknown): Lang {
  return isLang(v) ? v : DEFAULT_LANG;
}

// --- locale shape ------------------------------------------------------------
export interface AdminMessages {
  /** Option label for this language in the language dropdown. */
  languageOptionLabel: string;
  languageFieldLabel: string;

  settingsTitle: string;
  settingsIntro: string;
  saveButton: string;

  /** Webhook endpoint callout. `{url}` is replaced with the absolute URL. */
  webhookInfo: string;
  keyStatusLive: string;
  keyStatusTest: string;
  keyStatusMissing: string;

  // Keep labels short; put the supplementary detail in the matching placeholder.
  secretKeyLabel: string;
  secretKeyPlaceholder: string;
  publishableKeyLabel: string;
  publishableKeyPlaceholder: string;
  currencyLabel: string;
  currencyPlaceholder: string;
  priceUnitLabel: string;
  priceUnitMajorOption: string;
  priceUnitMinorOption: string;
  mappingsLabel: string;
  mappingsPlaceholder: string;
  successPathLabel: string;
  successPathPlaceholder: string;
  cancelPathLabel: string;
  cancelPathPlaceholder: string;
  allowPromotionCodesLabel: string;
  automaticTaxLabel: string;
  collectPhoneLabel: string;
  shippingCountriesLabel: string;
  shippingCountriesPlaceholder: string;
  ordersCollectionLabel: string;
  ordersCollectionPlaceholder: string;
  forwardUrlLabel: string;
  forwardUrlPlaceholder: string;
  forwardSecretLabel: string;
  forwardSecretPlaceholder: string;

  toastSaved: string;
  toastSaveFailed: string;
  toastInvalidMappings: string;
  toastInvalidForwardUrl: string;
  toastInvalidPath: string;

  paymentsTitle: string;
  paymentsIntro: string;
  colCreatedAt: string;
  colType: string;
  colStatus: string;
  colAmount: string;
  colEmail: string;
  colDescription: string;
}

export interface Locale {
  admin: AdminMessages;
}

// --- locales -----------------------------------------------------------------
const en: Locale = {
  admin: {
    languageOptionLabel: "English",
    languageFieldLabel: "Language",

    settingsTitle: "Stripe",
    settingsIntro:
      "Accept Stripe payments for your content entries. Map one or more collections as sellable below; each entry needs either a numeric price field or a Stripe Price ID field. API keys can also be provided via the host environment (STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY).",
    saveButton: "Save settings",

    webhookInfo:
      "Webhook endpoint: register {url} in the Stripe Dashboard (Developers → Webhooks). Deliveries are authenticated by re-fetching each event from the Stripe API, so no signing secret is required.",
    keyStatusLive: "Secret key: configured (live mode).",
    keyStatusTest: "Secret key: configured (test mode).",
    keyStatusMissing:
      "Secret key: not configured — payments are disabled until one is set here or via STRIPE_SECRET_KEY.",

    secretKeyLabel: "Secret key",
    secretKeyPlaceholder: "sk_live_... (leave blank to keep the current key)",
    publishableKeyLabel: "Publishable key",
    publishableKeyPlaceholder: "pk_live_... (exposed to the site via the config route)",
    currencyLabel: "Currency",
    currencyPlaceholder: "usd (ISO code; used when an entry has no currency field)",
    priceUnitLabel: "Price field unit",
    priceUnitMajorOption: "Major units (10.99 = $10.99, 1000 = ¥1000)",
    priceUnitMinorOption: "Minor units (1099 = $10.99; passed to Stripe as-is)",
    mappingsLabel: "Sellable collections (JSON)",
    mappingsPlaceholder:
      '[{"collection": "products", "priceField": "price", "priceIdField": "stripePriceId", "nameField": "name", "descriptionField": "description", "imageField": "image", "currencyField": "currency"}]',
    successPathLabel: "Success path",
    successPathPlaceholder: "/checkout/success",
    cancelPathLabel: "Cancel path",
    cancelPathPlaceholder: "/checkout/cancel",
    allowPromotionCodesLabel: "Allow promotion codes at checkout",
    automaticTaxLabel: "Automatic tax (requires Stripe Tax)",
    collectPhoneLabel: "Collect phone number at checkout",
    shippingCountriesLabel: "Shipping countries",
    shippingCountriesPlaceholder:
      "Two-letter ISO codes, comma or newline separated (e.g. US, JP). Empty = do not collect a shipping address.",
    ordersCollectionLabel: "Orders collection",
    ordersCollectionPlaceholder:
      "Optional: collection slug to create an order entry in when a payment succeeds (see README for the field contract).",
    forwardUrlLabel: "Forward events to URL",
    forwardUrlPlaceholder:
      "Optional: https URL that receives verified Stripe events as signed POSTs (X-Emdash-Stripe-Signature).",
    forwardSecretLabel: "Forwarding secret",
    forwardSecretPlaceholder:
      "Shared secret used to HMAC-sign forwarded events (leave blank to keep the current value)",

    toastSaved: "Settings saved.",
    toastSaveFailed: "Failed to save settings.",
    toastInvalidMappings: "Sellable collections must be a JSON array of {collection: ...} objects.",
    toastInvalidForwardUrl: "Forward URL must be an http(s) URL.",
    toastInvalidPath: "Success/cancel paths must start with “/”.",

    paymentsTitle: "Payments",
    paymentsIntro: "The most recent payment activity recorded from Stripe webhook events.",
    colCreatedAt: "Date",
    colType: "Type",
    colStatus: "Status",
    colAmount: "Amount",
    colEmail: "Email",
    colDescription: "Description",
  },
};

const ja: Locale = {
  admin: {
    languageOptionLabel: "日本語",
    languageFieldLabel: "言語",

    settingsTitle: "Stripe",
    settingsIntro:
      "コンテンツエントリをStripeで販売できます。下の設定で販売対象コレクションをマッピングしてください。各エントリには数値の価格フィールド、またはStripe Price IDフィールドが必要です。APIキーはホスト環境変数(STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY)でも指定できます。",
    saveButton: "設定を保存",

    webhookInfo:
      "Webhookエンドポイント: {url} をStripeダッシュボード(開発者 → Webhook)に登録してください。受信イベントはStripe APIから再取得して真正性を検証するため、署名シークレットは不要です。",
    keyStatusLive: "シークレットキー: 設定済み(本番モード)。",
    keyStatusTest: "シークレットキー: 設定済み(テストモード)。",
    keyStatusMissing:
      "シークレットキー: 未設定 — ここで設定するか STRIPE_SECRET_KEY を指定するまで決済は無効です。",

    secretKeyLabel: "シークレットキー",
    secretKeyPlaceholder: "sk_live_...(空欄なら現在のキーを維持)",
    publishableKeyLabel: "公開可能キー",
    publishableKeyPlaceholder: "pk_live_...(configルート経由でサイトに公開されます)",
    currencyLabel: "通貨",
    currencyPlaceholder: "jpy(ISOコード。エントリに通貨フィールドが無い場合に使用)",
    priceUnitLabel: "価格フィールドの単位",
    priceUnitMajorOption: "主要単位(10.99 = $10.99、1000 = ¥1000)",
    priceUnitMinorOption: "最小単位(1099 = $10.99。そのままStripeへ渡す)",
    mappingsLabel: "販売対象コレクション(JSON)",
    mappingsPlaceholder:
      '[{"collection": "products", "priceField": "price", "priceIdField": "stripePriceId", "nameField": "name", "descriptionField": "description", "imageField": "image", "currencyField": "currency"}]',
    successPathLabel: "決済成功パス",
    successPathPlaceholder: "/checkout/success",
    cancelPathLabel: "決済キャンセルパス",
    cancelPathPlaceholder: "/checkout/cancel",
    allowPromotionCodesLabel: "チェックアウトでプロモーションコードを許可",
    automaticTaxLabel: "自動税計算(Stripe Taxが必要)",
    collectPhoneLabel: "チェックアウトで電話番号を収集",
    shippingCountriesLabel: "配送先の国",
    shippingCountriesPlaceholder:
      "2文字のISOコードをカンマまたは改行区切りで(例: JP, US)。空欄なら配送先住所を収集しません。",
    ordersCollectionLabel: "注文コレクション",
    ordersCollectionPlaceholder:
      "任意: 決済成功時に注文エントリを作成するコレクションのスラッグ(フィールド仕様はREADME参照)。",
    forwardUrlLabel: "イベント転送先URL",
    forwardUrlPlaceholder:
      "任意: 検証済みStripeイベントを署名付きPOST(X-Emdash-Stripe-Signature)で受け取るhttps URL。",
    forwardSecretLabel: "転送用シークレット",
    forwardSecretPlaceholder:
      "転送イベントのHMAC署名に使う共有シークレット(空欄なら現在の値を維持)",

    toastSaved: "設定を保存しました。",
    toastSaveFailed: "設定の保存に失敗しました。",
    toastInvalidMappings: "販売対象コレクションは {collection: ...} オブジェクトのJSON配列で指定してください。",
    toastInvalidForwardUrl: "転送先URLは http(s) のURLで指定してください。",
    toastInvalidPath: "成功/キャンセルパスは「/」で始めてください。",

    paymentsTitle: "決済履歴",
    paymentsIntro: "Stripe Webhookイベントから記録された直近の決済アクティビティです。",
    colCreatedAt: "日時",
    colType: "種別",
    colStatus: "ステータス",
    colAmount: "金額",
    colEmail: "メール",
    colDescription: "内容",
  },
};

const LOCALES: Record<Lang, Locale> = { en, ja };

export function getLocale(lang: Lang): Locale {
  return LOCALES[lang];
}
