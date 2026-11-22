import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemorySlidingWindowStore } from "../lib/rateLimit/stores.js";

// Issue #289: ownership verification makes outbound HTTP/DNS requests, so it is
// rate-limited per provider and per API and answers 429 with Retry-After.

const { mockVerify } = vi.hoisted(() => ({ mockVerify: vi.fn() }));

vi.mock("../lib/rateLimit/index.js", () => {
  const store = new MemorySlidingWindowStore();
  return { getRateLimitStore: () => store };
});
vi.mock("../lib/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/metrics.js", () => ({ rateLimitCounter: { inc: vi.fn() } }));

import {
  OWNERSHIP_VERIFY_API_RATE_LIMIT_MAX,
  OWNERSHIP_VERIFY_PROVIDER_RATE_LIMIT_MAX,
  OWNERSHIP_VERIFY_RATE_LIMIT_WINDOW_MS,
  ownershipVerifyRateLimit,
} from "./ownershipVerifyRateLimit.js";

// Mirrors the route in routes/apis.ts: auth sets req.publisher, then the
// limiters, then the handler that makes the outbound verification request.
function app() {
  const a = express();
  a.post(
    "/apis/:id/verify-ownership",
    (req, _res, next) => {
      req.publisher = { id: String(req.headers["x-api-key"]) } as express.Request["publisher"];
      next();
    },
    ...ownershipVerifyRateLimit,
    (req, res) => {
      mockVerify(req.params.id);
      res.json({ id: req.params.id, verified: true });
    },
  );
  return a;
}

function verify(a: express.Express, publisher: string, apiId: string | number) {
  return request(a).post(`/apis/${apiId}/verify-ownership`).set("x-api-key", publisher);
}

describe("POST /apis/:id/verify-ownership rate limit", () => {
  beforeEach(() => {
    mockVerify.mockReset();
  });

  it("returns 429 with Retry-After past the per-API limit, without verifying", async () => {
    const a = app();
    for (let i = 0; i < OWNERSHIP_VERIFY_API_RATE_LIMIT_MAX; i++) {
      expect((await verify(a, "pub-api", 7)).status).toBe(200);
    }
    expect(mockVerify).toHaveBeenCalledTimes(OWNERSHIP_VERIFY_API_RATE_LIMIT_MAX);

    const limited = await verify(a, "pub-api", 7);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe("RATE_LIMITED");
    const retryAfter = Number(limited.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(OWNERSHIP_VERIFY_RATE_LIMIT_WINDOW_MS / 1000);
    // No outbound verification happened for the rejected request.
    expect(mockVerify).toHaveBeenCalledTimes(OWNERSHIP_VERIFY_API_RATE_LIMIT_MAX);

    // The same provider can still verify a different API.
    expect((await verify(a, "pub-api", 8)).status).toBe(200);
  });

  it("returns 429 past the per-provider limit, across different APIs", async () => {
    const a = app();
    for (let i = 0; i < OWNERSHIP_VERIFY_PROVIDER_RATE_LIMIT_MAX; i++) {
      expect((await verify(a, "pub-provider", 100 + i)).status).toBe(200);
    }
    const limited = await verify(a, "pub-provider", 999);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(mockVerify).not.toHaveBeenCalledWith("999");
  });

  it("gives each provider its own budget, even for the same API id", async () => {
    const a = app();
    for (let i = 0; i < OWNERSHIP_VERIFY_API_RATE_LIMIT_MAX; i++) {
      await verify(a, "pub-noisy", 42);
    }
    expect((await verify(a, "pub-noisy", 42)).status).toBe(429);
    // Someone hammering an id does not lock its owner out.
    expect((await verify(a, "pub-owner", 42)).status).toBe(200);
  });
});
