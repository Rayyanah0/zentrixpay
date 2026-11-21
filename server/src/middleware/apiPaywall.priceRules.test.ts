import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #192: the 402 challenge for each method/path advertises the price of
// the matching per-endpoint rule, and the API's default price otherwise.

const { state, mockResourceServer } = vi.hoisted(() => {
  const state = { api: null as Record<string, unknown> | null };
  // Stand-in for the x402 resource server: answers every unpaid request with
  // a 402 that advertises the configured price, like the real challenge.
  const mockResourceServer = vi.fn(
    async (_cfg: { network: string; payTo: string; price: string }) => ({
      middleware:
        (route: { price: string; network: string; payTo: string }) =>
        (_req: express.Request, res: express.Response) => {
          res.status(402).json({
            x402Version: 1,
            accepts: [
              { scheme: "exact", network: route.network, payTo: route.payTo, price: route.price },
            ],
          });
        },
    }),
  );
  return { state, mockResourceServer };
});

vi.mock("../config.js", () => ({ config: { NETWORK: "stellar:testnet" } }));
vi.mock("../db/client.js", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (state.api ? [state.api] : []) }),
      }),
    }),
  },
}));
vi.mock("../lib/payer.js", () => ({
  paymentHeader: () => undefined,
  payerFromPayment: () => ({ address: undefined, signed: false }),
}));
vi.mock("../lib/x402.js", () => ({ sharedX402ResourceServer: mockResourceServer }));
vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  apiPaywall,
  checkPayerAccess,
  clearApiPaywallCache,
  loadProxiedApi,
} from "./apiPaywall.js";

const PAY_TO = "GPAYEE7777777777777777777777777777777777777777777777777";

const API = {
  id: 1,
  listed: true,
  walletAddress: PAY_TO,
  description: "Items API",
  price: "0.01",
  allowedMethods: ["GET", "POST", "DELETE"],
  freeCallsPerDay: 0,
  payerDenylist: [],
  payerAllowlist: null,
  priceRules: [
    { method: "GET", pathPattern: "/items/*", price: "0.02" },
    { method: "GET", pathPattern: "/items/featured/*", price: "0.05" },
    { method: "GET", pathPattern: "/items/featured/today", price: "0.08" },
    { method: "POST", pathPattern: "/items/featured/today", price: "0.10" },
  ],
};

function app() {
  const a = express();
  // Same order as the proxy route in routes/apis.ts.
  a.all("/api/:id{/*path}", loadProxiedApi, checkPayerAccess, apiPaywall, (_req, res) => {
    res.status(200).json({ reachedUpstream: true });
  });
  return a;
}

async function advertisedPrice(method: "get" | "post" | "delete", path: string) {
  const res = await request(app())[method](`/api/1${path}`);
  expect(res.status).toBe(402);
  expect(res.body.accepts).toHaveLength(1);
  expect(res.body.accepts[0].payTo).toBe(PAY_TO);
  expect(res.body.accepts[0].network).toBe("stellar:testnet");
  return res.body.accepts[0].price as string;
}

describe("per-endpoint price rules on the proxy 402 (#192)", () => {
  beforeEach(() => {
    state.api = { ...API };
    mockResourceServer.mockClear();
    clearApiPaywallCache();
  });

  it.each([
    ["get", "/items/featured/today", "0.08"], // exact path beats wildcards
    ["get", "/items/featured/tomorrow", "0.05"], // most specific wildcard
    ["get", "/items/other", "0.02"], // broader wildcard
    ["post", "/items/featured/today", "0.10"], // rules are per method
  ] as const)("%s %s advertises the rule price %s", async (method, path, price) => {
    expect(await advertisedPrice(method, path)).toBe(price);
  });

  it.each([
    ["delete", "/items/featured/today"], // no rule for this method
    ["post", "/items/other"], // method has rules, but none for this path
    ["get", ""], // the API root
    ["get", "/other"], // no rule for this path
  ] as const)("%s %s falls back to the default price", async (method, path) => {
    expect(await advertisedPrice(method, path)).toBe("0.01");
  });

  it("uses the default price for every endpoint when the API has no rules", async () => {
    state.api = { ...API, priceRules: [] };
    expect(await advertisedPrice("get", "/items/featured/today")).toBe("0.01");
    expect(await advertisedPrice("post", "/items/featured/today")).toBe("0.01");
  });

  it("builds the x402 server with the resolved price and payee", async () => {
    await advertisedPrice("post", "/items/featured/today");
    expect(mockResourceServer).toHaveBeenCalledWith({
      network: "stellar:testnet",
      payTo: PAY_TO,
      price: "0.10",
    });
  });

  it("does not leak a cached price into a different endpoint of the same API", async () => {
    expect(await advertisedPrice("get", "/items/featured/today")).toBe("0.08");
    expect(await advertisedPrice("get", "/other")).toBe("0.01");
    expect(await advertisedPrice("get", "/items/featured/today")).toBe("0.08");
    expect(await advertisedPrice("get", "/items/other")).toBe("0.02");
  });

  it("does not issue a challenge for an unknown or unlisted API", async () => {
    state.api = { ...API, listed: false };
    const res = await request(app()).get("/api/1/items/other");
    expect(res.status).toBe(404);
    expect(mockResourceServer).not.toHaveBeenCalled();
  });
});
