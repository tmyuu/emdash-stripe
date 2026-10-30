import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Stripe from "stripe";
import type { PluginContext, SandboxedRouteContext } from "emdash/plugin";
import { handleWebhook } from "../src/sandbox-entry.js";
import { K } from "../src/config.js";

const WHSEC = "whsec_test_secret";

const event = {
  id: "evt_Test1",
  object: "event",
  type: "customer.created",
  created: 1_700_000_000,
  data: { object: { id: "cus_A1", object: "customer" } },
};

/** Minimal in-memory plugin context: KV-backed settings, storage, and a log. */
function makeCtx(settings: Record<string, string>) {
  const kv = new Map<string, unknown>(Object.entries(settings));
  const ctx = {
    kv: {
      get: async (key: string) => kv.get(key) ?? null,
      set: async (key: string, value: unknown) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    },
    storage: { payments: { get: async () => null, put: async () => {} } },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as unknown as PluginContext;
  return { ctx, kv };
}

function routeCtx(body: string, headers: Record<string, string> = {}): SandboxedRouteContext {
  return {
    input: body,
    request: { url: "https://example.test/_emdash/api/plugins/stripe/webhook", method: "POST", headers },
  };
}

async function sign(payload: string, secret = WHSEC): Promise<string> {
  return Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret,
    cryptoProvider: Stripe.createSubtleCryptoProvider(),
  });
}

/** Unwrap a raw plugin response into status + parsed JSON body. */
function read(res: unknown): { status: number; body: Record<string, unknown> } {
  const r = res as { status: number; body: { kind: string; value: string } };
  return { status: r.status, body: JSON.parse(r.body.value) };
}

// The Stripe API is never reached: events.retrieve is served from this stub.
const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes(`/v1/events/${event.id}`)) {
    return new Response(JSON.stringify(event), {
      status: 200,
      headers: { "content-type": "application/json", "request-id": "req_test" },
    });
  }
  return new Response(JSON.stringify({ error: { type: "invalid_request_error", message: "No such event" } }), {
    status: 404,
    headers: { "content-type": "application/json", "request-id": "req_test" },
  });
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("handleWebhook with a signing secret", () => {
  const settings = { [K.secretKey]: "sk_test_x", [K.webhookSecret]: WHSEC };

  it("accepts a correctly signed delivery without calling the API", async () => {
    const { ctx, kv } = makeCtx(settings);
    const raw = JSON.stringify(event);
    const res = read(await handleWebhook(routeCtx(raw, { "stripe-signature": await sign(raw) }), ctx));
    expect(res).toEqual({ status: 200, body: { received: true, type: "customer.created" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(kv.has(`state:evt:${event.id}`)).toBe(true);
  });

  it("reads the header from a Headers object too", async () => {
    const { ctx } = makeCtx(settings);
    const raw = JSON.stringify(event);
    const rc = routeCtx(raw);
    (rc.request as { headers: unknown }).headers = new Headers({ "Stripe-Signature": await sign(raw) });
    expect(read(await handleWebhook(rc, ctx)).status).toBe(200);
  });

  it("acknowledges a duplicate delivery without reprocessing", async () => {
    const { ctx } = makeCtx({ ...settings, [`state:evt:${event.id}`]: "seen" });
    const raw = JSON.stringify(event);
    const res = read(await handleWebhook(routeCtx(raw, { "stripe-signature": await sign(raw) }), ctx));
    expect(res).toEqual({ status: 200, body: { received: true, duplicate: true } });
  });

  it("rejects a tampered body with 400", async () => {
    const { ctx, kv } = makeCtx(settings);
    const raw = JSON.stringify(event);
    const header = await sign(raw);
    const tampered = raw.replace("cus_A1", "cus_EVIL");
    const res = read(await handleWebhook(routeCtx(tampered, { "stripe-signature": header }), ctx));
    expect(res).toEqual({ status: 400, body: { received: false, error: "invalid_signature" } });
    expect(kv.has(`state:evt:${event.id}`)).toBe(false);
  });

  it("rejects a signature made with another secret with 400", async () => {
    const { ctx } = makeCtx(settings);
    const raw = JSON.stringify(event);
    const header = await sign(raw, "whsec_other");
    expect(read(await handleWebhook(routeCtx(raw, { "stripe-signature": header }), ctx)).status).toBe(400);
  });

  it("rejects a missing signature header with 400", async () => {
    const { ctx } = makeCtx(settings);
    const res = read(await handleWebhook(routeCtx(JSON.stringify(event)), ctx));
    expect(res).toEqual({ status: 400, body: { received: false, error: "missing_signature" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("handleWebhook without a signing secret (re-fetch fallback)", () => {
  const settings = { [K.secretKey]: "sk_test_x" };

  it("re-fetches the named event from the API and processes what Stripe returns", async () => {
    const { ctx, kv } = makeCtx(settings);
    // The posted body is only a hint: its contents beyond the ID are ignored.
    const hint = JSON.stringify({ id: event.id, type: "checkout.session.completed" });
    const res = read(await handleWebhook(routeCtx(hint), ctx));
    expect(res).toEqual({ status: 200, body: { received: true, type: "customer.created" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kv.has(`state:evt:${event.id}`)).toBe(true);
  });

  it("ignores bodies without a valid event ID", async () => {
    const { ctx } = makeCtx(settings);
    for (const body of ["", "not json", JSON.stringify({ id: "cus_A1" })]) {
      expect(read(await handleWebhook(routeCtx(body), ctx))).toEqual({
        status: 200,
        body: { received: false, error: "invalid_event" },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws (non-2xx) when the event is unknown to Stripe", async () => {
    const { ctx, kv } = makeCtx(settings);
    await expect(handleWebhook(routeCtx(JSON.stringify({ id: "evt_Forged" })), ctx)).rejects.toThrow(
      "event_verification_failed",
    );
    expect(kv.has("state:evt:evt_Forged")).toBe(false);
  });
});

describe("handleWebhook without a secret key", () => {
  it("reports not_configured", async () => {
    const { ctx } = makeCtx({});
    expect(read(await handleWebhook(routeCtx("{}"), ctx))).toEqual({
      status: 200,
      body: { received: false, error: "not_configured" },
    });
  });
});
