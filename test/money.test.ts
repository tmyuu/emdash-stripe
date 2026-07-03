import { describe, it, expect } from "vitest";
import { toMinorUnits, formatAmount } from "../src/stripe.js";

describe("toMinorUnits", () => {
  it("passes zero-decimal currencies through (JPY)", () => {
    expect(toMinorUnits(1000, "jpy")).toBe(1000);
    expect(toMinorUnits(55000, "JPY")).toBe(55000);
  });

  it("multiplies two-decimal currencies by 100", () => {
    expect(toMinorUnits(10.99, "usd")).toBe(1099);
    expect(toMinorUnits(10, "eur")).toBe(1000);
  });

  it("handles three-decimal currencies with a trailing zero", () => {
    expect(toMinorUnits(1.234, "kwd")).toBe(1230);
    expect(toMinorUnits(1.236, "kwd")).toBe(1240);
  });
});

describe("formatAmount", () => {
  it("renders JPY without decimals and USD with two", () => {
    expect(formatAmount(55000, "jpy")).toBe("55000 JPY");
    expect(formatAmount(1099, "usd")).toBe("10.99 USD");
  });
});
