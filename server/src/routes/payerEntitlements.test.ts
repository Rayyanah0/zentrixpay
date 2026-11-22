import express from "express";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Issue #292: GET /payers/:address/entitlements — signed by the wallet, lists
// its active passes and credit balances.

const h = vi.hoisted(() => ({ results: [] as unknown[][] }));

vi.mock("../config.js", () => ({ config: { SIGNATURE_MAX_SKEW_MS: 300_000 } }));

// Each select resolves to the next queued result (passes first, then credits,
// matching the order listPayerEntitlements issues them).
vi.mock("../db/client.js", () => {
  const select = () => {
    const rows = h.results.shift() ?? [];
    const builder: unknown = new Proxy(function () {}, {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) =>
            Promise.resolve(rows).then(ok, err);
        }
        return () => builder;
      },
    });
    return builder;
  };
  return { db: { select } };
});

import { walletSignatureAuth } from "../middleware/walletSignatureAuth.js";
import {
  buildWalletAuthMessage,
  sep53Digest,
  verifyWalletAuthSignature,
} from "../lib/walletSignature.js";
import { listPayerEntitlements } from "../services/payerEntitlements.js";

const wallet = Keypair.random();
const PATH = `/payers/${wallet.publicKey()}/entitlements`;

function app() {
  const a = express();
  a.get("/payers/:address/entitlements", walletSignatureAuth, async (req, res) => {
    res.json(await listPayerEntitlements(req.params.address as string));
  });
  return a;
}

function sign(signer: Keypair, path = PATH, timestamp = String(Math.floor(Date.now() / 1000))) {
  const message = buildWalletAuthMessage({
    method: "GET",
    path,
    walletAddress: wallet.publicKey(),
    timestamp,
  });
  return {
    timestamp,
    raw: signer.sign(Buffer.from(message, "utf8")).toString("base64"),
    sep53: signer.sign(sep53Digest(message)).toString("base64"),
  };
}

beforeEach(() => {
  h.results = [];
});

describe("verifyWalletAuthSignature", () => {
  const base = { method: "GET", path: PATH, walletAddress: wallet.publicKey(), maxSkewMs: 300_000 };

  it("accepts raw and SEP-53 (Freighter) signatures", () => {
    const sig = sign(wallet);
    const nowMs = Number(sig.timestamp) * 1000;
    expect(
      verifyWalletAuthSignature({ ...base, timestamp: sig.timestamp, signature: sig.raw, nowMs }),
    ).toEqual({ ok: true });
    expect(
      verifyWalletAuthSignature({ ...base, timestamp: sig.timestamp, signature: sig.sep53, nowMs }),
    ).toEqual({ ok: true });
  });

  it("rejects stale timestamps and signatures for another path", () => {
    const sig = sign(wallet);
    const nowMs = Number(sig.timestamp) * 1000;
    expect(
      verifyWalletAuthSignature({
        ...base,
        timestamp: sig.timestamp,
        signature: sig.raw,
        nowMs: nowMs + 3_600_000,
      }),
    ).toEqual({ ok: false, error: "expired_timestamp" });
    expect(
      verifyWalletAuthSignature({
        ...base,
        path: "/payers/x/calls",
        timestamp: sig.timestamp,
        signature: sig.raw,
        nowMs,
      }),
    ).toEqual({ ok: false, error: "signature_mismatch" });
  });
});

describe("GET /payers/:address/entitlements", () => {
  it("requires the wallet's signature", async () => {
    expect((await request(app()).get(PATH)).status).toBe(401);

    const other = sign(Keypair.random());
    const res = await request(app())
      .get(PATH)
      .set("X-Wallet-Timestamp", other.timestamp)
      .set("X-Wallet-Signature", other.raw);
    expect(res.status).toBe(401);
  });

  it("rejects an address that is not a Stellar public key", async () => {
    expect((await request(app()).get("/payers/not-a-wallet/entitlements")).status).toBe(400);
  });

  it("returns the caller's active passes and credit balances after buying", async () => {
    const activeFrom = new Date("2026-11-21T10:00:00.000Z");
    const expiresAt = new Date("2026-11-21T11:00:00.000Z");
    const updatedAt = new Date("2026-11-21T09:30:00.000Z");
    h.results = [
      [{ passId: "pass-1", apiId: "api-1", apiName: "Weather", activeFrom, expiresAt }],
      [{ apiId: "api-2", apiName: "Geocoder", balance: 25, updatedAt }],
    ];

    const sig = sign(wallet);
    const res = await request(app())
      .get(PATH)
      .set("X-Wallet-Timestamp", sig.timestamp)
      .set("X-Wallet-Signature", sig.sep53);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      payer: wallet.publicKey(),
      passes: [
        {
          passId: "pass-1",
          apiId: "api-1",
          apiName: "Weather",
          activeFrom: activeFrom.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      ],
      credits: [
        { apiId: "api-2", apiName: "Geocoder", balance: 25, updatedAt: updatedAt.toISOString() },
      ],
    });
  });
});
