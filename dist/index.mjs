//#region src/index.ts
/**
* Build the EmDash plugin descriptor for Stripe payments. Takes no arguments —
* everything is configured from the admin settings page (see sandbox-entry).
*/
function stripePayments() {
	return {
		id: "stripe",
		version: "0.4.1",
		format: "standard",
		entrypoint: "emdash-stripe/sandbox",
		capabilities: [
			"content:read",
			"content:write",
			"network:request"
		],
		allowedHosts: ["api.stripe.com"],
		adminPages: [{
			path: "/settings",
			label: "Stripe",
			icon: "plug"
		}, {
			path: "/payments",
			label: "Payments",
			icon: "inbox"
		}],
		storage: { payments: { indexes: ["createdAt", "status"] } }
	};
}
//#endregion
export { stripePayments as default, stripePayments };
