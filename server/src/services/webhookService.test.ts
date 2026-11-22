import { describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    WEBHOOK_RETRY_BASE_MS: 1_000,
    WEBHOOK_TIMEOUT_MS: 5_000,
    UPSTREAM_SECRET_KEY: "x",
    PROXY_ALLOW_PRIVATE_UPSTREAMS: false,
  },
  upstreamKeyRing: [{ id: "k1", key: Buffer.alloc(32, 1) }],
}));

import {
  chargedCallWebhookEntry,
  signWebhookPayload,
  verifyWebhookSignature,
  webhookRetryDelayMs,
  webhookSignatureHeader,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./webhookService.js";

const call = {
  callId: "call-1",
  payerAddress: "GPAYER",
  amount: "0.01",
  method: "GET",
  path: "/weather",
  responseStatus: 200,
  durationMs: 12,
};

const api = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 7,
    webhookUrl: "https://provider.example/hooks",
    webhookSecretEnc: "enc",
    ...overrides,
  }) as never;

describe("charged-call webhook outbox entry", () => {
  it("is undefined when the API has no webhook configured", () => {
    expect(chargedCallWebhookEntry(api({ webhookUrl: null }), call)).toBeUndefined();
    expect(chargedCallWebhookEntry(api({ webhookSecretEnc: null }), call)).toBeUndefined();
  });

  it("carries a stable event id and the event body for the outbox", () => {
    const now = new Date("2026-01-02T03:04:05.000Z");
    const entry = chargedCallWebhookEntry(api(), call, now);
    expect(entry).toMatchObject({
      eventId: "evt_call-1",
      apiId: 7,
      url: "https://provider.example/hooks",
      secretEnc: "enc",
    });
    expect(JSON.parse(entry!.body)).toEqual({
      id: "evt_call-1",
      type: "api.call.charged",
      createdAt: "2026-01-02T03:04:05.000Z",
      data: { apiId: 7, currency: "USDC", ...call },
    });
  });

  it("signs the body as t=<unix>,v1=HMAC-SHA256(secret, `${t}.${body}`)", () => {
    const header = webhookSignatureHeader("s3cret", 1700000000, '{"a":1}');
    expect(header).toBe(`t=1700000000,v1=${signWebhookPayload("s3cret", 1700000000, '{"a":1}')}`);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
  });

  it("backs off exponentially between attempts", () => {
    expect([1, 2, 3].map(webhookRetryDelayMs)).toEqual([1_000, 4_000, 16_000]);
  });
});

// Sample event as the test suite sends it (see deliverChargedCallWebhook).
const SECRET = "whsec_test_value";
const BODY = JSON.stringify({ id: "evt_1", type: "api.call.charged", data: { apiId: 1 } });
const T = 1_700_000_000;

describe("verifyWebhookSignature", () => {
  it("accepts a header produced by the sender", () => {
    const header = webhookSignatureHeader(SECRET, T, BODY);
    expect(verifyWebhookSignature(SECRET, header, BODY, T + 10)).toEqual({ ok: true });
  });

  it("matches a known HMAC-SHA256 value over `${t}.${body}`", () => {
    expect(signWebhookPayload(SECRET, T, BODY)).toBe(
      webhookSignatureHeader(SECRET, T, BODY).split("v1=")[1],
    );
  });

  it("rejects a tampered body", () => {
    const header = webhookSignatureHeader(SECRET, T, BODY);
    expect(verifyWebhookSignature(SECRET, header, BODY.replace("evt_1", "evt_2"), T)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects the wrong secret", () => {
    const header = webhookSignatureHeader("other", T, BODY);
    expect(verifyWebhookSignature(SECRET, header, BODY, T)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects timestamps outside the 5-minute window in either direction", () => {
    const header = webhookSignatureHeader(SECRET, T, BODY);
    const edge = T + WEBHOOK_TOLERANCE_SECONDS;
    expect(verifyWebhookSignature(SECRET, header, BODY, edge)).toEqual({ ok: true });
    expect(verifyWebhookSignature(SECRET, header, BODY, edge + 1)).toEqual({
      ok: false,
      reason: "stale",
    });
    expect(verifyWebhookSignature(SECRET, header, BODY, T - WEBHOOK_TOLERANCE_SECONDS - 1)).toEqual(
      {
        ok: false,
        reason: "stale",
      },
    );
  });

  it("accepts when any of several v1 values matches", () => {
    const good = webhookSignatureHeader(SECRET, T, BODY);
    const bad = webhookSignatureHeader("old", T, BODY);
    expect(verifyWebhookSignature(SECRET, `${bad},${good.split(",")[1]}`, BODY, T)).toEqual({
      ok: true,
    });
  });

  it("reports missing and malformed headers", () => {
    expect(verifyWebhookSignature(SECRET, undefined, BODY, T)).toEqual({
      ok: false,
      reason: "missing_header",
    });
    expect(verifyWebhookSignature(SECRET, "v1=abc", BODY, T)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyWebhookSignature(SECRET, "t=abc,v1=zz", BODY, T)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });
});
