import { describe, it, expect } from "vitest";
import { parseMappings, asRecurringInterval, DEFAULT_MAPPINGS } from "../src/config.js";

describe("parseMappings", () => {
  it("falls back to the default mapping on blank or malformed input", () => {
    expect(parseMappings("")).toEqual(DEFAULT_MAPPINGS);
    expect(parseMappings("not json")).toEqual(DEFAULT_MAPPINGS);
    expect(parseMappings("[]")).toEqual(DEFAULT_MAPPINGS);
    expect(parseMappings('[{"noCollection": true}]')).toEqual(DEFAULT_MAPPINGS);
  });

  it("fills field defaults", () => {
    const [m] = parseMappings('[{"collection": "products"}]');
    expect(m).toMatchObject({
      collection: "products",
      priceField: "price",
      priceIdField: "stripePriceId",
      nameField: "name",
    });
    expect(m!.recurringEnabledField).toBeUndefined();
    expect(m!.recurringInterval).toBeUndefined();
  });

  it("parses recurring fields", () => {
    const [m] = parseMappings(
      JSON.stringify([
        {
          collection: "products",
          recurringEnabledField: "subscription_enabled",
          recurringPriceField: "subscription_price",
          recurringIntervalCountField: "subscription_interval_months",
          recurringNameTemplate: "{name} {count}ヶ月ごとの定期便",
        },
      ]),
    );
    expect(m).toMatchObject({
      recurringEnabledField: "subscription_enabled",
      recurringPriceField: "subscription_price",
      recurringIntervalCountField: "subscription_interval_months",
      recurringNameTemplate: "{name} {count}ヶ月ごとの定期便",
    });
  });

  it("drops invalid fixed recurring values", () => {
    const [m] = parseMappings(
      '[{"collection": "p", "recurringInterval": "decade", "recurringIntervalCount": 0.5}]',
    );
    expect(m!.recurringInterval).toBeUndefined();
    expect(m!.recurringIntervalCount).toBeUndefined();
  });

  it("keeps valid fixed recurring values", () => {
    const [m] = parseMappings('[{"collection": "p", "recurringInterval": "week", "recurringIntervalCount": 2}]');
    expect(m!.recurringInterval).toBe("week");
    expect(m!.recurringIntervalCount).toBe(2);
  });
});

describe("asRecurringInterval", () => {
  it("accepts only Stripe's four intervals", () => {
    expect(asRecurringInterval("month")).toBe("month");
    expect(asRecurringInterval("year")).toBe("year");
    expect(asRecurringInterval("quarter")).toBeUndefined();
    expect(asRecurringInterval(3)).toBeUndefined();
  });
});
