import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { subscriptionAmount } from "../src/sandbox-entry.js";

function sub(items: Array<{ unit: number | null; quantity?: number; currency?: string }>): Stripe.Subscription {
  return {
    items: {
      data: items.map((i) => ({
        quantity: i.quantity,
        price: { unit_amount: i.unit, currency: i.currency ?? "jpy" },
      })),
    },
  } as unknown as Stripe.Subscription;
}

describe("subscriptionAmount", () => {
  it("sums unit amount × quantity across all items", () => {
    expect(subscriptionAmount(sub([{ unit: 1000, quantity: 2 }, { unit: 500 }]))).toBe(2500);
  });

  it("returns null when any item lacks a fixed unit amount", () => {
    expect(subscriptionAmount(sub([{ unit: 1000 }, { unit: null }]))).toBeNull();
  });

  it("returns null when item currencies differ", () => {
    expect(subscriptionAmount(sub([{ unit: 1000 }, { unit: 500, currency: "usd" }]))).toBeNull();
  });

  it("returns null for a subscription without items", () => {
    expect(subscriptionAmount(sub([]))).toBeNull();
  });
});
