import { describe, it, expect } from "vitest";
import { sanitizeMetadata, renderRecurringName, itemsMetadata } from "../src/sandbox-entry.js";

describe("sanitizeMetadata", () => {
  it("passes plain string metadata through", () => {
    expect(sanitizeMetadata({ delivery_date: "2026-07-20", note: "" })).toEqual({
      delivery_date: "2026-07-20",
      note: "",
    });
  });

  it("strips reserved keys so clients cannot spoof plugin markers", () => {
    expect(sanitizeMetadata({ source: "evil", emdash_items: "x", emdash_desc: "y", ok: "1" })).toEqual(
      { ok: "1" },
    );
  });

  it("drops non-string values, over-long values, and enforces the key cap", () => {
    expect(sanitizeMetadata({ n: 1, obj: {}, long: "x".repeat(501), good: "v" })).toEqual({ good: "v" });
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "v"]));
    expect(Object.keys(sanitizeMetadata(many))).toHaveLength(20);
  });

  it("returns empty for non-objects", () => {
    expect(sanitizeMetadata(null)).toEqual({});
    expect(sanitizeMetadata("str")).toEqual({});
  });
});

describe("renderRecurringName", () => {
  it("falls back to the plain name without a template", () => {
    expect(renderRecurringName(undefined, "玄米クレンズ", 4, "month")).toBe("玄米クレンズ");
  });

  it("substitutes placeholders", () => {
    expect(renderRecurringName("{name} {count}ヶ月ごとの定期便", "玄米クレンズ", 4, "month")).toBe(
      "玄米クレンズ 4ヶ月ごとの定期便",
    );
    expect(renderRecurringName("{name} / every {count} {interval}(s)", "Tea", 2, "week")).toBe(
      "Tea / every 2 week(s)",
    );
  });
});

describe("itemsMetadata", () => {
  const item = (id: string, q = 1, name = "商品") => ({
    collection: "products",
    entryId: id,
    name,
    quantity: q,
    currency: "jpy",
    recurring: false,
    unitAmount: 1000,
  });

  it("encodes collection/id/quantity and a readable description", () => {
    const meta = itemsMetadata([item("a", 2, "玄米クレンズ")]);
    expect(JSON.parse(meta.emdash_items)).toEqual([{ c: "products", id: "a", q: 2 }]);
    expect(meta.emdash_desc).toBe("玄米クレンズ ×2");
  });

  it("degrades gracefully past the 500-char metadata limit", () => {
    const many = Array.from({ length: 60 }, (_, i) => item(`id-${i}-xxxxxxxxxx`));
    const meta = itemsMetadata(many);
    expect(meta.emdash_items.length).toBeLessThanOrEqual(500);
  });
});
