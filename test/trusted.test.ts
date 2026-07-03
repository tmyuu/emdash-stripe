import { describe, it, expect } from "vitest";
import { hmacSha256Hex, verifyTrustedToken } from "../src/stripe.js";
import { resolveTrusted } from "../src/sandbox-entry.js";
import type { Settings } from "../src/config.js";

const SECRET = "test-secret";

async function mint(
  payload: unknown,
  { secret = SECRET, at = Math.floor(Date.now() / 1000) } = {},
): Promise<string> {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `v1.${at}.${b64}.${await hmacSha256Hex(secret, `${at}.${b64}`)}`;
}

const cfg = { forwardSecret: SECRET } as Settings;

describe("verifyTrustedToken", () => {
  it("round-trips a valid token", async () => {
    const token = await mint({ customer: "cus_A1", setupFutureUsage: "off_session" });
    expect(await verifyTrustedToken(SECRET, token)).toEqual({
      customer: "cus_A1",
      setupFutureUsage: "off_session",
    });
  });

  it("rejects a wrong secret", async () => {
    expect(await verifyTrustedToken("other", await mint({ customer: "cus_A1" }))).toBeNull();
  });

  it("rejects stale and future timestamps beyond the tolerance", async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyTrustedToken(SECRET, await mint({ c: 1 }, { at: now - 301 }))).toBeNull();
    expect(await verifyTrustedToken(SECRET, await mint({ c: 1 }, { at: now + 301 }))).toBeNull();
    expect(await verifyTrustedToken(SECRET, await mint({ c: 1 }, { at: now - 250 }))).not.toBeNull();
  });

  it("rejects tampered signatures and payloads", async () => {
    const token = await mint({ customer: "cus_A1" });
    const [v, t, b64] = token.split(".");
    expect(await verifyTrustedToken(SECRET, `${v}.${t}.${b64}.${"0".repeat(64)}`)).toBeNull();
    const otherB64 = Buffer.from(JSON.stringify({ customer: "cus_EVIL" })).toString("base64url");
    const sig = token.split(".")[3];
    expect(await verifyTrustedToken(SECRET, `${v}.${t}.${otherB64}.${sig}`)).toBeNull();
  });

  it("rejects non-object payloads and malformed tokens", async () => {
    expect(await verifyTrustedToken(SECRET, await mint([1, 2]))).toBeNull();
    expect(await verifyTrustedToken(SECRET, "")).toBeNull();
    expect(await verifyTrustedToken(SECRET, "v1.notatoken")).toBeNull();
  });
});

describe("resolveTrusted", () => {
  it("returns empty fields when the request carries no token", async () => {
    expect(await resolveTrusted(cfg, {})).toEqual({ trusted: {} });
  });

  it("fails when a token is sent but no shared secret is configured", async () => {
    const res = await resolveTrusted({ forwardSecret: "" } as Settings, { trusted: "v1.x" });
    expect(res).toMatchObject({ ok: false, error: "trusted_not_configured" });
  });

  it("accepts a valid customer and setupFutureUsage", async () => {
    const token = await mint({ customer: "cus_A1", setupFutureUsage: "on_session" });
    expect(await resolveTrusted(cfg, { trusted: token })).toEqual({
      trusted: { customer: "cus_A1", setupFutureUsage: "on_session" },
    });
  });

  it("rejects malformed customer IDs and unknown setupFutureUsage values", async () => {
    expect(await resolveTrusted(cfg, { trusted: await mint({ customer: "price_X" }) })).toMatchObject(
      { ok: false, error: "invalid_trusted" },
    );
    expect(
      await resolveTrusted(cfg, { trusted: await mint({ setupFutureUsage: "always" }) }),
    ).toMatchObject({ ok: false, error: "invalid_trusted" });
  });

  it("rejects non-string trusted values", async () => {
    expect(await resolveTrusted(cfg, { trusted: 42 })).toMatchObject({
      ok: false,
      error: "invalid_trusted",
    });
  });
});
