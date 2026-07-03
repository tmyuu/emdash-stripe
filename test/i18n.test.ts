import { describe, it, expect } from "vitest";
import { getLocale, LANGS } from "../src/i18n.js";

describe("locales", () => {
  it("every language defines the same admin and error keys", () => {
    const [first, ...rest] = LANGS.map((l) => getLocale(l));
    for (const locale of rest) {
      expect(Object.keys(locale.admin).sort()).toEqual(Object.keys(first!.admin).sort());
      expect(Object.keys(locale.errors).sort()).toEqual(Object.keys(first!.errors).sort());
    }
  });

  it("error tables include a default fallback", () => {
    for (const l of LANGS) expect(getLocale(l).errors.default.length).toBeGreaterThan(0);
  });
});
