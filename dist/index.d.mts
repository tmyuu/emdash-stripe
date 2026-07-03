import { PluginDescriptor } from "emdash";

//#region src/index.d.ts
/**
 * Build the EmDash plugin descriptor for Stripe payments. Takes no arguments —
 * everything is configured from the admin settings page (see sandbox-entry).
 */
declare function stripePayments(): PluginDescriptor;
//#endregion
export { stripePayments as default, stripePayments };