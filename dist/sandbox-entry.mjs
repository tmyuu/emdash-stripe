import { env } from "cloudflare:workers";
import Stripe from "stripe";
//#region src/stripe.ts
/**
* Stripe client + money/signing helpers for emdash-stripe.
*
* Everything here is host-agnostic: no EmDash imports, no KV access. The
* plugin runs in-process inside the host Worker, so stripe-node talks to the
* Stripe API through the platform `fetch` and signs with Web Crypto.
*/
/**
* Build a Stripe client. stripe-node v22 resolves a Workers-native build via
* the `workerd` export condition (fetch + SubtleCrypto by default); passing
* the fetch HTTP client explicitly keeps behavior identical on non-Workers
* dev servers (e.g. a Node-based `astro dev`).
*
* `apiVersion` is intentionally omitted: requests use the SDK's pinned
* version, which is what the bundled TypeScript types describe.
*/
function getStripe(secretKey) {
	return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
}
const ZERO_DECIMAL = new Set([
	"bif",
	"clp",
	"djf",
	"gnf",
	"jpy",
	"kmf",
	"krw",
	"mga",
	"pyg",
	"rwf",
	"vnd",
	"vuv",
	"xaf",
	"xof",
	"xpf"
]);
const THREE_DECIMAL = new Set([
	"bhd",
	"jod",
	"kwd",
	"omr",
	"tnd"
]);
/**
* Convert an amount expressed in major units (e.g. 10.99 USD, 1000 JPY) to
* the minor-unit integer Stripe expects (1099, 1000).
*/
function toMinorUnits(amount, currency) {
	const c = currency.toLowerCase();
	if (ZERO_DECIMAL.has(c)) return Math.round(amount);
	if (THREE_DECIMAL.has(c)) return Math.round(amount * 1e3 / 10) * 10;
	return Math.round(amount * 100);
}
/**
* Render a minor-unit amount as a human-readable string for the admin UI
* (e.g. `1099 usd` → "10.99 USD", `1000 jpy` → "1000 JPY").
*/
function formatAmount(minor, currency) {
	const c = currency.toLowerCase();
	const decimals = ZERO_DECIMAL.has(c) ? 0 : THREE_DECIMAL.has(c) ? 3 : 2;
	return `${(minor / (decimals === 0 ? 1 : decimals === 3 ? 1e3 : 100)).toFixed(decimals)} ${currency.toUpperCase()}`;
}
/**
* HMAC-SHA256 over `payload` with `secret`, hex-encoded. Used to sign
* forwarded webhook events (`X-Emdash-Stripe-Signature: t=<unix>,v1=<hex>`
* where the signed payload is `<unix>.<body>`), mirroring Stripe's own
* signature scheme so hosts can verify with a few lines of Web Crypto.
*/
async function hmacSha256Hex(secret, payload) {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey("raw", enc.encode(secret), {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
	return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
/**
* Verify a host-signed request token and return its payload, or null.
*
* Format: `v1.<unix>.<base64url(json)>.<hex>` where
* `hex = HMAC-SHA256(secret, "<unix>.<base64url(json)>")` — the same secret
* and signature scheme as forwarded events, in the opposite direction. The
* signature covers the exact encoded string, so no canonicalization is
* involved; EmDash's body pre-parsing cannot break it. Tokens older (or
* newer) than the tolerance are rejected.
*/
async function verifyTrustedToken(secret, token) {
	const m = token.match(/^v1\.(\d+)\.([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/);
	if (!m) return null;
	const [, t, payloadB64, sig] = m;
	if (Math.abs(Date.now() / 1e3 - Number(t)) > 300) return null;
	if (await hmacSha256Hex(secret, `${t}.${payloadB64}`) !== sig) return null;
	try {
		const parsed = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}
//#endregion
//#region src/i18n.ts
/** Supported languages, in the order shown in the settings dropdown. */
const LANGS = ["en", "ja"];
function isLang(v) {
	return v === "en" || v === "ja";
}
function normalizeLang(v) {
	return isLang(v) ? v : "en";
}
const LOCALES = {
	en: { admin: {
		languageOptionLabel: "English",
		languageFieldLabel: "Language",
		settingsTitle: "Stripe",
		settingsIntro: "Accept Stripe payments for your content entries. Map one or more collections as sellable below; each entry needs either a numeric price field or a Stripe Price ID field. API keys can also be provided via the host environment (STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY).",
		saveButton: "Save settings",
		webhookInfo: "Webhook endpoint: register {url} in the Stripe Dashboard (Developers → Webhooks). Deliveries are authenticated by re-fetching each event from the Stripe API, so no signing secret is required.",
		keyStatusLive: "Secret key: configured (live mode).",
		keyStatusTest: "Secret key: configured (test mode).",
		keyStatusMissing: "Secret key: not configured — payments are disabled until one is set here or via STRIPE_SECRET_KEY.",
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
		mappingsPlaceholder: "[{\"collection\": \"products\", \"priceField\": \"price\", \"priceIdField\": \"stripePriceId\", \"nameField\": \"name\", \"descriptionField\": \"description\", \"imageField\": \"image\", \"currencyField\": \"currency\"}]",
		successPathLabel: "Success path",
		successPathPlaceholder: "/checkout/success",
		cancelPathLabel: "Cancel path",
		cancelPathPlaceholder: "/checkout/cancel",
		allowPromotionCodesLabel: "Allow promotion codes at checkout",
		automaticTaxLabel: "Automatic tax (requires Stripe Tax)",
		collectPhoneLabel: "Collect phone number at checkout",
		consentPromotionsLabel: "Ask for marketing-email consent at checkout (for recovery emails)",
		recoveryEnabledLabel: "Keep expired checkouts recoverable (abandoned-cart recovery URL)",
		shippingCountriesLabel: "Shipping countries",
		shippingCountriesPlaceholder: "Two-letter ISO codes, comma or newline separated (e.g. US, JP). Empty = do not collect a shipping address.",
		ordersCollectionLabel: "Orders collection",
		ordersCollectionPlaceholder: "Optional: collection slug to create an order entry in when a payment succeeds (see README for the field contract).",
		forwardUrlLabel: "Forward events to URL",
		forwardUrlPlaceholder: "Optional: https URL that receives verified Stripe events as signed POSTs (X-Emdash-Stripe-Signature).",
		forwardSecretLabel: "Forwarding secret",
		forwardSecretPlaceholder: "Shared secret used to HMAC-sign forwarded events (leave blank to keep the current value)",
		forwardBindingLabel: "Forward via service binding",
		forwardBindingPlaceholder: "Service binding name (e.g. SELF) — required when the forward URL is this same Worker, which cannot fetch its own hostname.",
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
		colDescription: "Description"
	} },
	ja: { admin: {
		languageOptionLabel: "日本語",
		languageFieldLabel: "言語",
		settingsTitle: "Stripe",
		settingsIntro: "コンテンツエントリをStripeで販売できます。下の設定で販売対象コレクションをマッピングしてください。各エントリには数値の価格フィールド、またはStripe Price IDフィールドが必要です。APIキーはホスト環境変数(STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY)でも指定できます。",
		saveButton: "設定を保存",
		webhookInfo: "Webhookエンドポイント: {url} をStripeダッシュボード(開発者 → Webhook)に登録してください。受信イベントはStripe APIから再取得して真正性を検証するため、署名シークレットは不要です。",
		keyStatusLive: "シークレットキー: 設定済み(本番モード)。",
		keyStatusTest: "シークレットキー: 設定済み(テストモード)。",
		keyStatusMissing: "シークレットキー: 未設定 — ここで設定するか STRIPE_SECRET_KEY を指定するまで決済は無効です。",
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
		mappingsPlaceholder: "[{\"collection\": \"products\", \"priceField\": \"price\", \"priceIdField\": \"stripePriceId\", \"nameField\": \"name\", \"descriptionField\": \"description\", \"imageField\": \"image\", \"currencyField\": \"currency\"}]",
		successPathLabel: "決済成功パス",
		successPathPlaceholder: "/checkout/success",
		cancelPathLabel: "決済キャンセルパス",
		cancelPathPlaceholder: "/checkout/cancel",
		allowPromotionCodesLabel: "チェックアウトでプロモーションコードを許可",
		automaticTaxLabel: "自動税計算(Stripe Taxが必要)",
		collectPhoneLabel: "チェックアウトで電話番号を収集",
		consentPromotionsLabel: "チェックアウトで販促メールの同意を収集(カゴ落ち回収メール用)",
		recoveryEnabledLabel: "期限切れチェックアウトを復元可能にする(カゴ落ち復元URL)",
		shippingCountriesLabel: "配送先の国",
		shippingCountriesPlaceholder: "2文字のISOコードをカンマまたは改行区切りで(例: JP, US)。空欄なら配送先住所を収集しません。",
		ordersCollectionLabel: "注文コレクション",
		ordersCollectionPlaceholder: "任意: 決済成功時に注文エントリを作成するコレクションのスラッグ(フィールド仕様はREADME参照)。",
		forwardUrlLabel: "イベント転送先URL",
		forwardUrlPlaceholder: "任意: 検証済みStripeイベントを署名付きPOST(X-Emdash-Stripe-Signature)で受け取るhttps URL。",
		forwardSecretLabel: "転送用シークレット",
		forwardSecretPlaceholder: "転送イベントのHMAC署名に使う共有シークレット(空欄なら現在の値を維持)",
		forwardBindingLabel: "転送に使うService Binding",
		forwardBindingPlaceholder: "Binding名(例: SELF)。転送先URLがこのWorker自身の場合は必須(Workerは自分のホスト名へfetchできないため)。",
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
		colDescription: "内容"
	} }
};
function getLocale(lang) {
	return LOCALES[lang];
}
//#endregion
//#region src/config.ts
const K = {
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
	consentPromotions: "settings:consentPromotions",
	recoveryEnabled: "settings:recoveryEnabled",
	shippingCountries: "settings:shippingCountries",
	ordersCollection: "settings:ordersCollection",
	forwardUrl: "settings:forwardUrl",
	forwardSecret: "settings:forwardSecret",
	forwardBinding: "settings:forwardBinding"
};
const RECURRING_INTERVALS = [
	"day",
	"week",
	"month",
	"year"
];
function asRecurringInterval(v) {
	return typeof v === "string" && RECURRING_INTERVALS.includes(v) ? v : void 0;
}
const DEFAULT_MAPPINGS = [{
	collection: "products",
	priceField: "price",
	priceIdField: "stripePriceId",
	nameField: "name"
}];
/** Parse the mappings JSON from settings; malformed input falls back to the default. */
function parseMappings(raw) {
	if (!raw.trim()) return DEFAULT_MAPPINGS;
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_MAPPINGS;
		const mappings = [];
		for (const m of parsed) {
			if (!m || typeof m !== "object" || typeof m.collection !== "string" || !m.collection) return DEFAULT_MAPPINGS;
			const str = (v) => typeof v === "string" && v.trim() ? v.trim() : void 0;
			const count = typeof m.recurringIntervalCount === "number" ? m.recurringIntervalCount : NaN;
			mappings.push({
				collection: m.collection,
				priceField: str(m.priceField) ?? "price",
				priceIdField: str(m.priceIdField) ?? "stripePriceId",
				nameField: str(m.nameField) ?? "name",
				descriptionField: str(m.descriptionField),
				imageField: str(m.imageField),
				currencyField: str(m.currencyField),
				recurringEnabledField: str(m.recurringEnabledField),
				recurringPriceField: str(m.recurringPriceField),
				recurringIntervalField: str(m.recurringIntervalField),
				recurringInterval: asRecurringInterval(m.recurringInterval),
				recurringIntervalCountField: str(m.recurringIntervalCountField),
				recurringIntervalCount: Number.isInteger(count) && count >= 1 ? count : void 0,
				recurringNameTemplate: str(m.recurringNameTemplate)
			});
		}
		return mappings;
	} catch {
		return DEFAULT_MAPPINGS;
	}
}
/** Validate raw mappings JSON for the settings form (stricter than the lenient parse). */
function isValidMappingsJson(raw) {
	if (!raw.trim()) return true;
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) && parsed.every((m) => m && typeof m === "object" && typeof m.collection === "string" && m.collection);
	} catch {
		return false;
	}
}
function envStr(name) {
	const v = env[name];
	return typeof v === "string" ? v : "";
}
async function getStr(ctx, key, def = "") {
	const v = await ctx.kv.get(key);
	return typeof v === "string" && v.length > 0 ? v : def;
}
function sanitizePath(p, def) {
	const s = p.trim();
	return s.startsWith("/") && !s.startsWith("//") ? s : def;
}
function splitCountries(raw) {
	return raw.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c));
}
async function loadSettings(ctx) {
	return {
		lang: normalizeLang(await getStr(ctx, K.language, "en")),
		secretKey: await getStr(ctx, K.secretKey) || envStr("STRIPE_SECRET_KEY"),
		publishableKey: await getStr(ctx, K.publishableKey) || envStr("STRIPE_PUBLISHABLE_KEY"),
		currency: (await getStr(ctx, K.currency, "usd")).toLowerCase(),
		priceUnit: await getStr(ctx, K.priceUnit) === "minor" ? "minor" : "major",
		mappings: parseMappings(await getStr(ctx, K.mappings)),
		successPath: sanitizePath(await getStr(ctx, K.successPath), "/checkout/success"),
		cancelPath: sanitizePath(await getStr(ctx, K.cancelPath), "/checkout/cancel"),
		allowPromotionCodes: await getStr(ctx, K.allowPromotionCodes) === "1",
		automaticTax: await getStr(ctx, K.automaticTax) === "1",
		collectPhone: await getStr(ctx, K.collectPhone) === "1",
		consentPromotions: await getStr(ctx, K.consentPromotions) === "1",
		recoveryEnabled: await getStr(ctx, K.recoveryEnabled) === "1",
		shippingCountries: splitCountries(await getStr(ctx, K.shippingCountries)),
		ordersCollection: (await getStr(ctx, K.ordersCollection)).trim(),
		forwardUrl: (await getStr(ctx, K.forwardUrl)).trim(),
		forwardSecret: await getStr(ctx, K.forwardSecret),
		forwardBinding: (await getStr(ctx, K.forwardBinding)).trim()
	};
}
//#endregion
//#region src/admin.ts
async function buildSettingsPage(ctx) {
	const cfg = await loadSettings(ctx);
	const t = getLocale(cfg.lang).admin;
	const webhookUrl = ctx.url(`/_emdash/api/plugins/${ctx.plugin.id}/webhook`);
	const keyStatus = !cfg.secretKey ? t.keyStatusMissing : /^(sk|rk)_test_/.test(cfg.secretKey) ? t.keyStatusTest : t.keyStatusLive;
	return { blocks: [
		{
			type: "header",
			text: t.settingsTitle
		},
		{
			type: "section",
			text: t.settingsIntro
		},
		{
			type: "section",
			text: t.webhookInfo.replace("{url}", webhookUrl)
		},
		{
			type: "section",
			text: keyStatus
		},
		{
			type: "form",
			submit: {
				label: t.saveButton,
				action_id: "save_settings"
			},
			fields: [
				{
					type: "select",
					action_id: "language",
					label: t.languageFieldLabel,
					initial_value: cfg.lang,
					options: LANGS.map((l) => ({
						value: l,
						label: getLocale(l).admin.languageOptionLabel
					}))
				},
				{
					type: "secret_input",
					action_id: "secretKey",
					label: t.secretKeyLabel,
					placeholder: t.secretKeyPlaceholder
				},
				{
					type: "text_input",
					action_id: "publishableKey",
					label: t.publishableKeyLabel,
					placeholder: t.publishableKeyPlaceholder,
					initial_value: await getStr(ctx, K.publishableKey)
				},
				{
					type: "text_input",
					action_id: "currency",
					label: t.currencyLabel,
					placeholder: t.currencyPlaceholder,
					initial_value: cfg.currency
				},
				{
					type: "select",
					action_id: "priceUnit",
					label: t.priceUnitLabel,
					initial_value: cfg.priceUnit,
					options: [{
						value: "major",
						label: t.priceUnitMajorOption
					}, {
						value: "minor",
						label: t.priceUnitMinorOption
					}]
				},
				{
					type: "text_input",
					action_id: "mappings",
					label: t.mappingsLabel,
					placeholder: t.mappingsPlaceholder,
					multiline: true,
					initial_value: JSON.stringify(cfg.mappings, null, 2)
				},
				{
					type: "text_input",
					action_id: "successPath",
					label: t.successPathLabel,
					placeholder: t.successPathPlaceholder,
					initial_value: cfg.successPath
				},
				{
					type: "text_input",
					action_id: "cancelPath",
					label: t.cancelPathLabel,
					placeholder: t.cancelPathPlaceholder,
					initial_value: cfg.cancelPath
				},
				{
					type: "toggle",
					action_id: "allowPromotionCodes",
					label: t.allowPromotionCodesLabel,
					initial_value: cfg.allowPromotionCodes
				},
				{
					type: "toggle",
					action_id: "automaticTax",
					label: t.automaticTaxLabel,
					initial_value: cfg.automaticTax
				},
				{
					type: "toggle",
					action_id: "collectPhone",
					label: t.collectPhoneLabel,
					initial_value: cfg.collectPhone
				},
				{
					type: "toggle",
					action_id: "consentPromotions",
					label: t.consentPromotionsLabel,
					initial_value: cfg.consentPromotions
				},
				{
					type: "toggle",
					action_id: "recoveryEnabled",
					label: t.recoveryEnabledLabel,
					initial_value: cfg.recoveryEnabled
				},
				{
					type: "text_input",
					action_id: "shippingCountries",
					label: t.shippingCountriesLabel,
					placeholder: t.shippingCountriesPlaceholder,
					initial_value: cfg.shippingCountries.join(", ")
				},
				{
					type: "text_input",
					action_id: "ordersCollection",
					label: t.ordersCollectionLabel,
					placeholder: t.ordersCollectionPlaceholder,
					initial_value: cfg.ordersCollection
				},
				{
					type: "text_input",
					action_id: "forwardUrl",
					label: t.forwardUrlLabel,
					placeholder: t.forwardUrlPlaceholder,
					initial_value: cfg.forwardUrl
				},
				{
					type: "secret_input",
					action_id: "forwardSecret",
					label: t.forwardSecretLabel,
					placeholder: t.forwardSecretPlaceholder
				},
				{
					type: "text_input",
					action_id: "forwardBinding",
					label: t.forwardBindingLabel,
					placeholder: t.forwardBindingPlaceholder,
					initial_value: cfg.forwardBinding
				}
			]
		}
	] };
}
async function saveSettings(ctx, values) {
	if (typeof values.language === "string") await ctx.kv.set(K.language, normalizeLang(values.language));
	const t = getLocale(normalizeLang(await getStr(ctx, K.language, "en"))).admin;
	try {
		if (typeof values.mappings === "string" && !isValidMappingsJson(values.mappings)) return {
			...await buildSettingsPage(ctx),
			toast: {
				message: t.toastInvalidMappings,
				type: "error"
			}
		};
		const forwardUrl = typeof values.forwardUrl === "string" ? values.forwardUrl.trim() : "";
		if (forwardUrl && !/^https?:\/\//.test(forwardUrl)) return {
			...await buildSettingsPage(ctx),
			toast: {
				message: t.toastInvalidForwardUrl,
				type: "error"
			}
		};
		for (const key of ["successPath", "cancelPath"]) {
			const v = typeof values[key] === "string" ? values[key].trim() : "";
			if (v && !v.startsWith("/")) return {
				...await buildSettingsPage(ctx),
				toast: {
					message: t.toastInvalidPath,
					type: "error"
				}
			};
		}
		const setStr = async (key, v) => {
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
		for (const [key, kvKey] of [
			["allowPromotionCodes", K.allowPromotionCodes],
			["automaticTax", K.automaticTax],
			["collectPhone", K.collectPhone],
			["consentPromotions", K.consentPromotions],
			["recoveryEnabled", K.recoveryEnabled]
		]) if (values[key] === true) await ctx.kv.set(kvKey, "1");
		else await ctx.kv.delete(kvKey);
		for (const [key, kvKey] of [["secretKey", K.secretKey], ["forwardSecret", K.forwardSecret]]) {
			const v = values[key];
			if (typeof v === "string" && v.trim()) await ctx.kv.set(kvKey, v.trim());
		}
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: t.toastSaved,
				type: "success"
			}
		};
	} catch (err) {
		ctx.log.error("Failed to save Stripe settings", err);
		return {
			...await buildSettingsPage(ctx),
			toast: {
				message: t.toastSaveFailed,
				type: "error"
			}
		};
	}
}
async function buildPaymentsPage(ctx) {
	const t = getLocale((await loadSettings(ctx)).lang).admin;
	let rows = [];
	try {
		rows = ((await ctx.storage.payments.query({
			orderBy: { createdAt: "desc" },
			limit: 100
		})).items ?? []).map((item) => {
			const d = item.data ?? {};
			const amount = typeof d.amount === "number" ? d.amount : null;
			const currency = typeof d.currency === "string" ? d.currency : null;
			return {
				createdAt: d.createdAt ?? "",
				type: d.objectType ?? "",
				status: d.status ?? "",
				amount: amount != null && currency ? formatAmount(amount, currency) : "",
				email: d.email ?? "",
				description: d.description ?? ""
			};
		});
	} catch (err) {
		ctx.log.error("Failed to load payment records", err);
	}
	return { blocks: [
		{
			type: "header",
			text: t.paymentsTitle
		},
		{
			type: "section",
			text: t.paymentsIntro
		},
		{
			type: "table",
			blockId: "payments-table",
			columns: [
				{
					key: "createdAt",
					label: t.colCreatedAt,
					format: "datetime"
				},
				{
					key: "type",
					label: t.colType,
					format: "text"
				},
				{
					key: "status",
					label: t.colStatus,
					format: "text"
				},
				{
					key: "amount",
					label: t.colAmount,
					format: "text"
				},
				{
					key: "email",
					label: t.colEmail,
					format: "text"
				},
				{
					key: "description",
					label: t.colDescription,
					format: "text"
				}
			],
			rows
		}
	] };
}
async function handleAdmin(routeCtx, ctx) {
	const it = routeCtx.input;
	if (it.type === "page_load" && it.page === "/payments") return buildPaymentsPage(ctx);
	if (it.type === "page_load") return buildSettingsPage(ctx);
	if (it.type === "form_submit" && it.action_id === "save_settings") return saveSettings(ctx, it.values ?? {});
	return { blocks: [] };
}
//#endregion
//#region src/sandbox-entry.ts
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRICE_ID_RE = /^price_[A-Za-z0-9]+$/;
const EVENT_ID_RE = /^evt_[A-Za-z0-9]+$/;
const SESSION_ID_RE = /^cs_[A-Za-z0-9_]+$/;
const CUSTOMER_ID_RE = /^cus_[A-Za-z0-9]+$/;
const METADATA_SOURCE = "emdash-stripe";
async function resolveTrusted(cfg, body) {
	if (body.trusted === void 0) return { trusted: {} };
	if (typeof body.trusted !== "string") return fail("invalid_trusted");
	if (!cfg.forwardSecret) return fail("trusted_not_configured");
	const payload = await verifyTrustedToken(cfg.forwardSecret, body.trusted);
	if (!payload) return fail("invalid_trusted");
	const trusted = {};
	const customer = str(payload.customer);
	if (customer) {
		if (!CUSTOMER_ID_RE.test(customer)) return fail("invalid_trusted");
		trusted.customer = customer;
	}
	if (payload.setupFutureUsage !== void 0) {
		if (payload.setupFutureUsage !== "on_session" && payload.setupFutureUsage !== "off_session") return fail("invalid_trusted");
		trusted.setupFutureUsage = payload.setupFutureUsage;
	}
	return { trusted };
}
function fail(error, detail) {
	return detail ? {
		ok: false,
		error,
		detail
	} : {
		ok: false,
		error
	};
}
function str(v) {
	return typeof v === "string" && v.trim() ? v.trim() : void 0;
}
/** Site-relative path from client input; anything else → undefined. */
function relPath(v) {
	const s = str(v);
	return s && s.startsWith("/") && !s.startsWith("//") && s.length <= 500 ? s : void 0;
}
function withSessionParam(url) {
	return `${url}${url.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`;
}
/**
* URL base for absolute URLs (Stripe rejects relative ones). The configured
* site URL wins when present; EmDash 0.27 leaves route contexts without site
* info (emdash-cms/emdash#1813), in which case the origin comes from the
* originating request.
*/
function urlBase(ctx, routeCtx) {
	return ctx.site.url || new URL(routeCtx.request.url).origin;
}
/** Client-supplied metadata: string→string, capped, reserved keys stripped. */
function sanitizeMetadata(v) {
	const out = {};
	if (!v || typeof v !== "object") return out;
	let n = 0;
	for (const [key, val] of Object.entries(v)) {
		if (n >= 20) break;
		if (!key || key.length > 40 || key === "source" || key.startsWith("emdash")) continue;
		if (typeof val !== "string" || val.length > 500) continue;
		out[key] = val;
		n += 1;
	}
	return out;
}
async function findBySlug(ctx, collection, slug) {
	let cursor;
	for (let page = 0; page < 20; page++) {
		const result = await ctx.content.list(collection, {
			limit: 100,
			cursor,
			where: { status: "published" }
		});
		const hit = result.items.find((e) => e.slug === slug);
		if (hit) return hit;
		if (!result.hasMore || !result.cursor) return null;
		cursor = result.cursor;
	}
	return null;
}
function toNum(v) {
	return typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
}
/** Display name for a recurring line item from the mapping's template. */
function renderRecurringName(template, name, count, interval) {
	if (!template) return name;
	return template.replaceAll("{name}", name).replaceAll("{count}", String(count)).replaceAll("{interval}", interval).slice(0, 250);
}
function resolveImage(origin, v) {
	let url;
	if (typeof v === "string") url = v.trim();
	else if (v && typeof v === "object") {
		const u = v.url;
		if (typeof u === "string") url = u.trim();
	}
	if (!url) return void 0;
	if (/^https?:\/\//.test(url)) return url;
	if (url.startsWith("/") && !url.startsWith("//")) return `${origin}${url}`;
}
async function resolveItems(ctx, stripe, cfg, origin, input) {
	if (!Array.isArray(input) || input.length === 0 || input.length > 100) return fail("invalid_items");
	const items = [];
	for (const raw of input) {
		if (!raw || typeof raw !== "object") return fail("invalid_items");
		const collectionName = str(raw.collection) ?? cfg.mappings[0]?.collection;
		const mapping = cfg.mappings.find((m) => m.collection === collectionName);
		if (!mapping) return fail("unknown_collection", String(collectionName));
		const id = str(raw.id);
		const slug = str(raw.slug);
		if (!id && !slug) return fail("invalid_items");
		const entry = id ? await ctx.content.get(mapping.collection, id) : await findBySlug(ctx, mapping.collection, slug);
		if (!entry || entry.status !== "published") return fail("unknown_item", `${mapping.collection}/${id ?? slug}`);
		const qtyRaw = typeof raw.quantity === "number" ? raw.quantity : 1;
		const quantity = Math.min(999, Math.max(1, Math.floor(qtyRaw)));
		const data = entry.data;
		const name = str(data[mapping.nameField]) ?? str(data.title) ?? str(data.name) ?? entry.slug ?? entry.id;
		const priceId = str(data[mapping.priceIdField]);
		if (priceId && PRICE_ID_RE.test(priceId)) {
			let price;
			try {
				price = await stripe.prices.retrieve(priceId);
			} catch (err) {
				ctx.log.error(`Failed to retrieve Stripe price ${priceId}`, err);
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
				unitAmount: price.unit_amount
			});
			continue;
		}
		const currency = mapping.currencyField && str(data[mapping.currencyField])?.toLowerCase() || cfg.currency;
		if (raw.recurring === true) {
			if (mapping.recurringEnabledField && !data[mapping.recurringEnabledField]) return fail("not_recurring", `${mapping.collection}/${entry.id}`);
			const priceNum = toNum(data[mapping.recurringPriceField ?? mapping.priceField]);
			if (!Number.isFinite(priceNum) || priceNum <= 0) return fail("missing_price", `${mapping.collection}/${entry.id}`);
			const interval = mapping.recurringIntervalField && asRecurringInterval(data[mapping.recurringIntervalField]) || mapping.recurringInterval || "month";
			const countNum = mapping.recurringIntervalCountField ? toNum(data[mapping.recurringIntervalCountField]) : NaN;
			const intervalCount = Number.isInteger(countNum) && countNum >= 1 ? countNum : mapping.recurringIntervalCount ?? 1;
			items.push({
				collection: mapping.collection,
				entryId: entry.id,
				name: renderRecurringName(mapping.recurringNameTemplate, name, intervalCount, interval),
				quantity,
				currency,
				recurring: true,
				unitAmount: cfg.priceUnit === "minor" ? Math.round(priceNum) : toMinorUnits(priceNum, currency),
				interval,
				intervalCount
			});
			continue;
		}
		const priceNum = toNum(data[mapping.priceField]);
		if (!Number.isFinite(priceNum) || priceNum < 0) return fail("missing_price", `${mapping.collection}/${entry.id}`);
		const unitAmount = cfg.priceUnit === "minor" ? Math.round(priceNum) : toMinorUnits(priceNum, currency);
		items.push({
			collection: mapping.collection,
			entryId: entry.id,
			name,
			quantity,
			currency,
			recurring: false,
			unitAmount,
			description: mapping.descriptionField ? str(data[mapping.descriptionField]) : void 0,
			image: mapping.imageField ? resolveImage(origin, data[mapping.imageField]) : void 0
		});
	}
	const currencies = new Set(items.map((i) => i.currency));
	if (currencies.size > 1) return fail("mixed_currencies", [...currencies].join(","));
	return { items };
}
/** Compact metadata describing what was bought, for webhooks and host apps. */
function itemsMetadata(items) {
	let json = JSON.stringify(items.map((i) => ({
		c: i.collection,
		id: i.entryId,
		q: i.quantity
	})));
	if (json.length > 500) json = JSON.stringify(items.map((i) => ({
		id: i.entryId,
		q: i.quantity
	})));
	if (json.length > 500) json = JSON.stringify({ count: items.length });
	const desc = items.map((i) => i.quantity > 1 ? `${i.name} ×${i.quantity}` : i.name).join(", ").slice(0, 200);
	return {
		emdash_items: json,
		emdash_desc: desc
	};
}
async function handleCheckout(routeCtx, ctx) {
	const cfg = await loadSettings(ctx);
	if (!cfg.secretKey) return fail("not_configured");
	if (!ctx.content) return fail("content_unavailable");
	const body = routeCtx.input ?? {};
	const stripe = getStripe(cfg.secretKey);
	const trustedResult = await resolveTrusted(cfg, body);
	if ("error" in trustedResult) return trustedResult;
	const trusted = trustedResult.trusted;
	const base = urlBase(ctx, routeCtx);
	const resolved = await resolveItems(ctx, stripe, cfg, base, body.items);
	if ("error" in resolved) return resolved;
	const items = resolved.items;
	const anyRecurring = items.some((i) => i.recurring);
	let mode;
	if (body.mode === "payment" || body.mode === "subscription") {
		mode = body.mode;
		if (mode === "payment" && anyRecurring) return fail("recurring_requires_subscription");
	} else mode = anyRecurring ? "subscription" : "payment";
	const lineItems = items.map((i) => i.priceId ? {
		price: i.priceId,
		quantity: i.quantity
	} : {
		quantity: i.quantity,
		price_data: {
			currency: i.currency,
			unit_amount: i.unitAmount,
			product_data: {
				name: i.name,
				...i.description ? { description: i.description } : {},
				...i.image ? { images: [i.image] } : {}
			},
			...i.recurring && i.interval ? { recurring: {
				interval: i.interval,
				interval_count: i.intervalCount ?? 1
			} } : {}
		}
	});
	const meta = itemsMetadata(items);
	const clientMetadata = sanitizeMetadata(body.metadata);
	const metadata = {
		source: METADATA_SOURCE,
		...meta,
		...clientMetadata
	};
	const params = {
		mode,
		line_items: lineItems,
		metadata
	};
	if (trusted.customer) params.customer = trusted.customer;
	const customerEmail = str(body.customerEmail);
	if (!params.customer && customerEmail && EMAIL_RE.test(customerEmail)) params.customer_email = customerEmail;
	const clientReference = str(body.clientReference);
	if (clientReference && /^[\w.-]{1,200}$/.test(clientReference)) params.client_reference_id = clientReference;
	if (cfg.allowPromotionCodes) params.allow_promotion_codes = true;
	if (cfg.automaticTax) params.automatic_tax = { enabled: true };
	if (cfg.collectPhone) params.phone_number_collection = { enabled: true };
	if (cfg.shippingCountries.length > 0) params.shipping_address_collection = { allowed_countries: cfg.shippingCountries };
	if (mode === "subscription") params.subscription_data = { metadata };
	if (mode === "payment") {
		params.payment_intent_data = {
			description: meta.emdash_desc,
			metadata: {
				...meta,
				...clientMetadata
			}
		};
		if (cfg.consentPromotions) params.consent_collection = { promotions: "auto" };
		if (cfg.recoveryEnabled) params.after_expiration = { recovery: {
			enabled: true,
			allow_promotion_codes: cfg.allowPromotionCodes
		} };
	}
	const embedded = body.uiMode === "embedded" || body.uiMode === "embedded_page";
	if (embedded) {
		params.ui_mode = "embedded_page";
		params.return_url = withSessionParam(`${base}${relPath(body.returnPath) ?? relPath(body.successPath) ?? cfg.successPath}`);
	} else {
		params.success_url = withSessionParam(`${base}${relPath(body.successPath) ?? cfg.successPath}`);
		params.cancel_url = `${base}${relPath(body.cancelPath) ?? cfg.cancelPath}`;
	}
	try {
		const session = await stripe.checkout.sessions.create(params);
		return embedded ? {
			ok: true,
			id: session.id,
			clientSecret: session.client_secret
		} : {
			ok: true,
			id: session.id,
			url: session.url
		};
	} catch (err) {
		ctx.log.error("Failed to create checkout session", err);
		return fail("stripe_error", err.message);
	}
}
async function handlePaymentIntent(routeCtx, ctx) {
	const cfg = await loadSettings(ctx);
	if (!cfg.secretKey) return fail("not_configured");
	if (!ctx.content) return fail("content_unavailable");
	const body = routeCtx.input ?? {};
	const stripe = getStripe(cfg.secretKey);
	const trustedResult = await resolveTrusted(cfg, body);
	if ("error" in trustedResult) return trustedResult;
	const trusted = trustedResult.trusted;
	const resolved = await resolveItems(ctx, stripe, cfg, urlBase(ctx, routeCtx), body.items);
	if ("error" in resolved) return resolved;
	const items = resolved.items;
	if (items.some((i) => i.recurring)) return fail("recurring_not_supported");
	if (items.some((i) => i.unitAmount == null)) return fail("unsupported_price");
	const amount = items.reduce((sum, i) => sum + i.unitAmount * i.quantity, 0);
	if (amount <= 0) return fail("invalid_amount");
	const currency = items[0].currency;
	const meta = itemsMetadata(items);
	const params = {
		amount,
		currency,
		description: str(body.description)?.slice(0, 500) ?? meta.emdash_desc,
		metadata: {
			source: METADATA_SOURCE,
			...meta,
			...sanitizeMetadata(body.metadata)
		},
		automatic_payment_methods: { enabled: true }
	};
	if (trusted.customer) params.customer = trusted.customer;
	if (trusted.setupFutureUsage && trusted.customer) params.setup_future_usage = trusted.setupFutureUsage;
	const receiptEmail = str(body.receiptEmail);
	if (receiptEmail && EMAIL_RE.test(receiptEmail)) params.receipt_email = receiptEmail;
	try {
		const pi = await stripe.paymentIntents.create(params);
		return {
			ok: true,
			id: pi.id,
			clientSecret: pi.client_secret,
			amount,
			currency
		};
	} catch (err) {
		ctx.log.error("Failed to create payment intent", err);
		return fail("stripe_error", err.message);
	}
}
async function handleSession(routeCtx, ctx) {
	const cfg = await loadSettings(ctx);
	if (!cfg.secretKey) return fail("not_configured");
	const sessionId = str((routeCtx.input ?? {}).sessionId);
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
			clientReferenceId: s.client_reference_id ?? null
		};
	} catch (err) {
		ctx.log.error("Failed to retrieve checkout session", err);
		return fail("stripe_error");
	}
}
async function handleConfig(_routeCtx, ctx) {
	const cfg = await loadSettings(ctx);
	return {
		ok: true,
		publishableKey: cfg.publishableKey,
		currency: cfg.currency,
		collections: cfg.mappings.map((m) => m.collection),
		successPath: cfg.successPath,
		cancelPath: cfg.cancelPath
	};
}
async function upsertPayment(ctx, id, patch) {
	const store = ctx.storage.payments;
	const existing = await store.get(id);
	const now = (/* @__PURE__ */ new Date()).toISOString();
	const record = {
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
		...existing ?? {},
		...patch,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now
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
async function maybeCreateOrder(ctx, cfg, recordId, record) {
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
			items: record.items ?? ""
		});
		await ctx.kv.set(markerKey, {
			entryId: entry.id,
			at: (/* @__PURE__ */ new Date()).toISOString()
		});
	} catch (err) {
		ctx.log.error(`Failed to create an order entry in "${cfg.ordersCollection}" — does the collection exist with the documented fields?`, err);
	}
}
/**
* Forward a verified event to the host URL as an HMAC-signed POST. Returns
* true when delivered (2xx) or when forwarding is disabled, false on any
* failure — the caller then refuses the Stripe delivery so the event is
* retried rather than lost (hosts fulfill orders from these forwards).
*/
async function forwardEvent(ctx, cfg, event) {
	if (!cfg.forwardUrl || !cfg.forwardSecret) return true;
	let doFetch = fetch;
	if (cfg.forwardBinding) {
		const bound = env[cfg.forwardBinding];
		if (typeof bound?.fetch !== "function") {
			ctx.log.error(`Forward binding "${cfg.forwardBinding}" is not a service binding on the host Worker — check wrangler.jsonc "services"`);
			return false;
		}
		doFetch = bound.fetch.bind(bound);
	}
	try {
		const body = JSON.stringify(event);
		const t = Math.floor(Date.now() / 1e3);
		const signature = await hmacSha256Hex(cfg.forwardSecret, `${t}.${body}`);
		const res = await doFetch(cfg.forwardUrl, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-emdash-stripe-signature": `t=${t},v1=${signature}`
			},
			body
		});
		if (!res.ok) {
			ctx.log.warn(`Event forward returned HTTP ${res.status}`, { eventId: event.id });
			return false;
		}
		return true;
	} catch (err) {
		ctx.log.error("Event forward failed", err);
		return false;
	}
}
async function processEvent(ctx, cfg, event) {
	const type = event.type;
	if (type.startsWith("checkout.session.")) {
		const s = event.data.object;
		let status;
		if (type === "checkout.session.completed") status = s.payment_status !== "unpaid" ? "paid" : "pending";
		else if (type === "checkout.session.async_payment_succeeded") status = "paid";
		else if (type === "checkout.session.async_payment_failed") status = "failed";
		else if (type === "checkout.session.expired") status = "expired";
		else return;
		const piId = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id ?? null;
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
			stripeCreatedAt: (/* @__PURE__ */ new Date(s.created * 1e3)).toISOString(),
			lastEventType: type,
			lastEventId: event.id
		});
		if (piId) await ctx.kv.set(`state:pi:${piId}`, s.id);
		if (s.metadata?.source === METADATA_SOURCE) await maybeCreateOrder(ctx, cfg, s.id, record);
		return;
	}
	if (type === "payment_intent.succeeded" || type === "payment_intent.payment_failed") {
		const pi = event.data.object;
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
			stripeCreatedAt: (/* @__PURE__ */ new Date(pi.created * 1e3)).toISOString(),
			lastEventType: type,
			lastEventId: event.id
		});
		await maybeCreateOrder(ctx, cfg, pi.id, record);
		return;
	}
	if (type === "charge.refunded") {
		const ch = event.data.object;
		const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id ?? null;
		if (!piId) return;
		const recordId = await ctx.kv.get(`state:pi:${piId}`) ?? piId;
		const existing = await ctx.storage.payments.get(recordId);
		await upsertPayment(ctx, recordId, {
			status: ch.refunded ? "refunded" : "partially_refunded",
			refundedAmount: ch.amount_refunded,
			...existing ? {} : {
				objectType: "payment_intent",
				amount: ch.amount,
				currency: ch.currency,
				email: ch.billing_details?.email ?? null,
				customerName: ch.billing_details?.name ?? null,
				description: ch.description ?? null,
				paymentIntentId: piId,
				stripeCreatedAt: (/* @__PURE__ */ new Date(ch.created * 1e3)).toISOString()
			},
			lastEventType: type,
			lastEventId: event.id
		});
		return;
	}
	if (type.startsWith("customer.subscription.")) {
		if (type !== "customer.subscription.created" && type !== "customer.subscription.updated" && type !== "customer.subscription.deleted") return;
		const sub = event.data.object;
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
			stripeCreatedAt: (/* @__PURE__ */ new Date(sub.created * 1e3)).toISOString(),
			lastEventType: type,
			lastEventId: event.id
		});
		return;
	}
	if (type === "invoice.paid" || type === "invoice.payment_failed") {
		const inv = event.data.object;
		if (!inv.id) return;
		const invLoose = inv;
		let subscriptionId = typeof invLoose.subscription === "string" ? invLoose.subscription : null;
		if (!subscriptionId) {
			const details = invLoose.parent?.subscription_details;
			if (details && typeof details.subscription === "string") subscriptionId = details.subscription;
		}
		await upsertPayment(ctx, inv.id, {
			objectType: "invoice",
			status: type === "invoice.paid" ? "paid" : "failed",
			amount: inv.amount_paid || inv.amount_due || null,
			currency: inv.currency ?? null,
			email: inv.customer_email ?? null,
			customerName: inv.customer_name ?? null,
			subscriptionId,
			stripeCreatedAt: (/* @__PURE__ */ new Date(inv.created * 1e3)).toISOString(),
			lastEventType: type,
			lastEventId: event.id
		});
		return;
	}
}
async function handleWebhook(routeCtx, ctx) {
	const input = routeCtx.input ?? {};
	const id = typeof input.id === "string" ? input.id : "";
	if (!EVENT_ID_RE.test(id)) return {
		received: false,
		error: "invalid_event"
	};
	const cfg = await loadSettings(ctx);
	if (!cfg.secretKey) return {
		received: false,
		error: "not_configured"
	};
	const dedupKey = `state:evt:${id}`;
	if (await ctx.kv.get(dedupKey)) return {
		received: true,
		duplicate: true
	};
	const stripe = getStripe(cfg.secretKey);
	let event;
	try {
		event = await stripe.events.retrieve(id);
	} catch (err) {
		ctx.log.warn(`Webhook event ${id} could not be verified against the Stripe API`, { message: err.message });
		throw new Error("event_verification_failed");
	}
	await processEvent(ctx, cfg, event);
	if (!await forwardEvent(ctx, cfg, event)) throw new Error("event_forward_failed");
	await ctx.kv.set(dedupKey, {
		type: event.type,
		at: (/* @__PURE__ */ new Date()).toISOString()
	});
	return {
		received: true,
		type: event.type
	};
}
var sandbox_entry_default = { routes: {
	checkout: {
		public: true,
		handler: handleCheckout
	},
	"payment-intent": {
		public: true,
		handler: handlePaymentIntent
	},
	session: {
		public: true,
		handler: handleSession
	},
	config: {
		public: true,
		handler: handleConfig
	},
	webhook: {
		public: true,
		handler: handleWebhook
	},
	admin: { handler: handleAdmin }
} };
//#endregion
export { sandbox_entry_default as default };
