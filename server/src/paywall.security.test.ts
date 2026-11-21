import express from "express";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #293: security regression suite for the paywall. Each case attacks the
// gateway the way an outside caller would, through the real Express app, and
// asserts the attack is refused. Only the edges are faked: the database (an
// in-memory query stub keyed by table), the x402 resource server (always
// answers 402) and the upstream HTTP client (records whether it was reached).
//
// The cases are expected to fail until the matching fix lands; do not weaken
// an assertion to make it pass.

const h = vi.hoisted(() => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    NETWORK: "stellar:testnet",
    USDC_CONTRACT_ID: "CUSDCTESTCONTRACT",
    SOROBAN_RPC_URL: "https://soroban-testnet.example",
    DATABASE_URL: "postgres://security:security@127.0.0.1:5432/security",
    REGISTRY_CONTRACT_ID: "CREGISTRYTESTCONTRACT",
    REGISTRY_SECRET_KEY: "SSECURITYTESTSECRET",
    REQUIRE_REQUEST_SIGNATURE: "false",
  });

  type Row = Record<string, unknown>;
  const state = {
    /** Rows a select/update against a table resolves to. */
    rows: new Map<unknown, Row[]>(),
    /** Every insert, in order. */
    inserts: [] as Array<{ table: unknown; values: Row }>,
    /** Emulates the unique request_nonce index on api_credit_ledger. */
    usedNonces: new Set<string>(),
    ledgerTable: undefined as unknown,
  };

  function chain(op: "select" | "insert" | "update" | "delete", initialTable?: unknown) {
    let table = initialTable;
    let values: Row | undefined;
    const resolve = (): Row[] => {
      if (op === "insert") {
        if (table === state.ledgerTable && values && typeof values.requestNonce === "string") {
          if (state.usedNonces.has(values.requestNonce)) return [];
          state.usedNonces.add(values.requestNonce);
        }
        return [{ id: `row-${state.inserts.length}`, ...values }];
      }
      return state.rows.get(table) ?? [];
    };
    const builder: unknown = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === "then") {
          return (onOk: (v: Row[]) => unknown, onErr: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(resolve)
              .then(onOk, onErr);
        }
        return (...args: unknown[]) => {
          if (prop === "from" && table === undefined) table = args[0];
          if (prop === "values") {
            values = args[0] as Row;
            state.inserts.push({ table, values });
          }
          return builder;
        };
      },
    });
    return builder;
  }

  const db: Record<string, unknown> = {
    select: () => chain("select"),
    selectDistinct: () => chain("select"),
    insert: (table: unknown) => chain("insert", table),
    update: (table: unknown) => chain("update", table),
    delete: (table: unknown) => chain("delete", table),
    execute: async () => [],
    transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };

  return {
    state,
    db,
    payer: { address: undefined as string | undefined, signed: false },
    sendUpstream: vi.fn(),
    streamUpstream: vi.fn(),
  };
});

vi.mock("./db/client.js", () => ({ db: h.db }));

vi.mock("./lib/x402.js", () => {
  const challenge = () => (_req: express.Request, res: express.Response) => {
    res.status(402).json({ error: "Payment required" });
  };
  return {
    sharedX402ResourceServer: vi.fn(async () => ({ middleware: challenge })),
  };
});

// The attacker controls the payment header. `payerFromPayment` reports which
// wallet the header names and whether that wallet actually signed it.
vi.mock("./lib/payer.js", () => ({
  paymentHeader: (req: express.Request) => {
    const header = req.headers["payment-signature"] ?? req.headers["x-payment"];
    return typeof header === "string" && header ? header : undefined;
  },
  paymentHeaderHash: (header: string) => `hash:${header}`,
  payerFromPayment: (header: string | undefined) =>
    header ? { ...h.payer } : { address: undefined, signed: false },
  payerFrom: () => h.payer.address ?? "unknown",
}));

vi.mock("./lib/upstreamClient.js", () => ({
  sendUpstream: h.sendUpstream,
  streamUpstream: h.streamUpstream,
  UpstreamError: class UpstreamError extends Error {},
}));

import { createApp } from "./app.js";
import { apiCalls, apiCreditBalances, apiCreditLedger, apiPasses, apis } from "./db/schema.js";
import { buildApiCreditSpendMessage, apiCreditRequestBodyHash } from "./lib/apiCreditSignature.js";
import { buildPayeeChangeMessage } from "./utils/payeeSignature.js";
import { payeeSignatureAuth } from "./middleware/payeeSignatureAuth.js";

const API_ID = "api-security-1";
const PAYEE = Keypair.random().publicKey();
const VICTIM = Keypair.random().publicKey();
const FORGED_PAYMENT = Buffer.from(
  JSON.stringify({ x402Version: 2, payload: { authorization: { from: VICTIM } } }),
).toString("base64");

function apiRow(overrides: Record<string, unknown> = {}) {
  return {
    id: API_ID,
    publisherId: "publisher-1",
    name: "Security target",
    description: null,
    upstreamUrl: "https://upstream.example/v1",
    price: "0.01",
    priceRules: [],
    passPrice: "1.00",
    freeCallsPerDay: 0,
    walletAddress: PAYEE,
    network: "stellar:testnet",
    allowedMethods: ["GET", "POST"],
    listed: true,
    streamingEnabled: false,
    payerAllowlist: [],
    payerDenylist: [],
    archivedAt: null,
    ...overrides,
  };
}

function nowSeconds(): string {
  return String(Math.floor(Date.now() / 1000));
}

function insertsInto(table: unknown) {
  return h.state.inserts.filter((insert) => insert.table === table);
}

beforeEach(() => {
  h.state.rows.clear();
  h.state.inserts.length = 0;
  h.state.usedNonces.clear();
  h.state.ledgerTable = apiCreditLedger;
  h.state.rows.set(apis, [apiRow()]);
  h.state.rows.set(apiCalls, [{ count: 0 }]);
  h.payer = { address: undefined, signed: false };
  h.sendUpstream.mockReset();
  h.sendUpstream.mockResolvedValue({
    status: 200,
    headers: { "content-type": "text/plain" },
    body: Buffer.from("upstream data"),
  });
  h.streamUpstream.mockReset();
});

describe("paywall security regressions (#293)", () => {
  describe("forged payment header on pass purchase", () => {
    it("does not issue a pass for an unsettled, unsigned payment header", async () => {
      h.payer = { address: VICTIM, signed: false };

      const res = await request(createApp())
        .post(`/api/${API_ID}/pass`)
        .set("X-Payment", FORGED_PAYMENT);

      expect(res.status).toBe(402);
      expect(insertsInto(apiPasses)).toEqual([]);
    });
  });

  describe("pass-holder impersonation", () => {
    it("does not let a header that merely names a pass holder skip the paywall", async () => {
      h.payer = { address: VICTIM, signed: false };
      h.state.rows.set(apiPasses, [
        { id: "pass-1", apiId: API_ID, payerAddress: VICTIM, expiresAt: new Date(Date.now() + 3_600_000) },
      ]);

      const res = await request(createApp())
        .get(`/api/${API_ID}/data`)
        .set("X-Payment", FORGED_PAYMENT);

      expect(res.status).toBe(402);
      expect(h.sendUpstream).not.toHaveBeenCalled();
      expect(h.streamUpstream).not.toHaveBeenCalled();
    });
  });

  describe("random-address free quota", () => {
    it("does not grant free calls to an address the caller has not proven it controls", async () => {
      h.state.rows.set(apis, [apiRow({ freeCallsPerDay: 5 })]);
      h.payer = { address: Keypair.random().publicKey(), signed: false };

      const res = await request(createApp())
        .get(`/api/${API_ID}/data`)
        .set("X-Payment", FORGED_PAYMENT);

      expect(res.status).toBe(402);
      expect(h.sendUpstream).not.toHaveBeenCalled();
      expect(h.streamUpstream).not.toHaveBeenCalled();
    });
  });

  describe("unauthenticated stats and history reads", () => {
    it("refuses provider stats without an API key", async () => {
      const app = createApp();
      expect((await request(app).get(`/apis/${API_ID}/stats`)).status).toBe(401);
      expect((await request(app).get(`/apis/${API_ID}/stats/time-series`)).status).toBe(401);
    });

    it("does not serve stats from the unauthenticated /:id/stats duplicate", async () => {
      const res = await request(createApp()).get(`/${API_ID}/stats`);
      expect(res.status).toBe(404);
      expect(res.body).not.toHaveProperty("recentCalls");
    });

    it("refuses a wallet's call history and entitlements without that wallet's signature", async () => {
      const app = createApp();
      expect((await request(app).get(`/payers/${VICTIM}/calls`)).status).toBe(401);
      expect((await request(app).get(`/payers/${VICTIM}/entitlements`)).status).toBe(401);
    });

    it("refuses a signature from a different wallet", async () => {
      const attacker = Keypair.random();
      const timestamp = nowSeconds();
      const path = `/payers/${VICTIM}/calls`;
      const message = ["zentrixpay:wallet-auth", "GET", path, VICTIM, timestamp].join("\n");
      const signature = attacker.sign(Buffer.from(message, "utf8")).toString("base64");

      const res = await request(createApp())
        .get(path)
        .set("X-Wallet-Timestamp", timestamp)
        .set("X-Wallet-Signature", signature);

      expect(res.status).toBe(401);
    });
  });

  describe("credit-spend replay", () => {
    const wallet = Keypair.random();

    function signedCreditHeaders(path: string, nonce: string) {
      const timestamp = nowSeconds();
      const message = buildApiCreditSpendMessage({
        walletAddress: wallet.publicKey(),
        apiId: API_ID,
        method: "GET",
        path,
        timestamp,
        nonce,
        bodyHash: apiCreditRequestBodyHash(undefined),
      });
      return {
        "X-Credit-Wallet": wallet.publicKey(),
        "X-Credit-Timestamp": timestamp,
        "X-Credit-Nonce": nonce,
        "X-Credit-Signature": wallet.sign(Buffer.from(message, "utf8")).toString("base64"),
      };
    }

    beforeEach(() => {
      h.state.rows.set(apiCreditBalances, [{ balance: 10 }]);
    });

    it("spends a signed credit request at most once", async () => {
      const app = createApp();
      const path = `/api/${API_ID}/data`;
      const headers = signedCreditHeaders(path, "replay-nonce-0001");

      const first = await request(app).get(path).set(headers);
      const replay = await request(app).get(path).set(headers);

      expect(first.status).toBe(200);
      expect(replay.status).toBe(409);
      expect(h.sendUpstream.mock.calls.length + h.streamUpstream.mock.calls.length).toBe(1);
      expect(insertsInto(apiCreditLedger)).toHaveLength(2);
    });

    it("rejects a signed credit request replayed against another path", async () => {
      const headers = signedCreditHeaders(`/api/${API_ID}/cheap`, "replay-nonce-0002");

      const res = await request(createApp()).get(`/api/${API_ID}/expensive`).set(headers);

      expect(res.status).toBe(401);
      expect(insertsInto(apiCreditLedger)).toEqual([]);
      expect(h.sendUpstream).not.toHaveBeenCalled();
    });
  });

  describe("payee-change replay", () => {
    const walletA = Keypair.random();
    const walletB = Keypair.random();

    function payeeApp(current: { id: string; walletAddress: string }) {
      const app = express();
      app.use(express.json());
      app.patch(
        "/apis/:id",
        (_req, res, next) => {
          res.locals.api = { ...current };
          next();
        },
        payeeSignatureAuth,
        (req, res) => {
          current.walletAddress = req.body.walletAddress;
          res.json({ walletAddress: current.walletAddress });
        },
      );
      return app;
    }

    function signedChange(signer: Keypair, newAddress: string) {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildPayeeChangeMessage(API_ID, newAddress, timestamp);
      return {
        body: { walletAddress: newAddress },
        headers: {
          "X-Payee-Timestamp": String(timestamp),
          "X-Payee-Signature": signer.sign(Buffer.from(message, "utf8")).toString("base64"),
        },
      };
    }

    it("refuses to replay an old payee-change signature after the payee changed back", async () => {
      const current = { id: API_ID, walletAddress: walletA.publicKey() };
      const app = payeeApp(current);

      const toB = signedChange(walletA, walletB.publicKey());
      const backToA = signedChange(walletB, walletA.publicKey());

      expect((await request(app).patch(`/apis/${API_ID}`).set(toB.headers).send(toB.body)).status).toBe(200);
      expect(
        (await request(app).patch(`/apis/${API_ID}`).set(backToA.headers).send(backToA.body)).status,
      ).toBe(200);

      const replay = await request(app).patch(`/apis/${API_ID}`).set(toB.headers).send(toB.body);

      expect(replay.status).not.toBe(200);
      expect(current.walletAddress).toBe(walletA.publicKey());
    });

    it("refuses a payee-change signature made for another API", async () => {
      const current = { id: API_ID, walletAddress: walletA.publicKey() };
      const app = payeeApp(current);
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildPayeeChangeMessage("another-api", walletB.publicKey(), timestamp);

      const res = await request(app)
        .patch(`/apis/${API_ID}`)
        .set("X-Payee-Timestamp", String(timestamp))
        .set("X-Payee-Signature", walletA.sign(Buffer.from(message, "utf8")).toString("base64"))
        .send({ walletAddress: walletB.publicKey() });

      expect(res.status).toBe(403);
      expect(current.walletAddress).toBe(walletA.publicKey());
    });
  });
});
