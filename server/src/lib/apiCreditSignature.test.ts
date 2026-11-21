import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "node:crypto";
import {
  apiCreditRequestBodyHash,
  buildApiCreditSpendMessage,
  verifyApiCreditSpendSignature,
} from "./apiCreditSignature.js";

describe("API credit spend signatures", () => {
  it("verifies a wallet signature bound to the request and rejects a changed path", () => {
    const keypair = Keypair.random();
    const nowMs = Date.now();
    const input = {
      walletAddress: keypair.publicKey(),
      apiId: "api1",
      method: "POST",
      path: "/api/api1/generate",
      timestamp: String(Math.floor(nowMs / 1000)),
      nonce: "nonce-request-0001",
      bodyHash: apiCreditRequestBodyHash(Buffer.from('{"prompt":"hello"}')),
    };
    const signature = keypair
      .sign(Buffer.from(buildApiCreditSpendMessage(input)))
      .toString("base64");
    const request = { ...input, signature, nowMs, maxSkewMs: 300_000 };

    expect(verifyApiCreditSpendSignature(request)).toEqual({ ok: true });
    expect(verifyApiCreditSpendSignature({ ...request, path: "/api/api1/other" })).toEqual({
      ok: false,
      error: "signature_mismatch",
    });
  });

  it("accepts a SEP-53 signature (as Freighter signMessage produces) over the same message", () => {
    const keypair = Keypair.random();
    const nowMs = Date.now();
    const input = {
      walletAddress: keypair.publicKey(),
      apiId: "api1",
      method: "POST",
      path: "/api/api1/generate",
      timestamp: String(Math.floor(nowMs / 1000)),
      nonce: "nonce-sep53-000001",
      bodyHash: apiCreditRequestBodyHash(Buffer.from('{"prompt":"hello"}')),
    };
    const message = Buffer.from(buildApiCreditSpendMessage(input), "utf8");
    // SEP-53: ed25519 over sha256("Stellar Signed Message:\n" + message).
    const digest = createHash("sha256")
      .update("Stellar Signed Message:\n", "utf8")
      .update(message)
      .digest();
    const signature = keypair.sign(digest).toString("base64");
    const request = { ...input, signature, nowMs, maxSkewMs: 300_000 };

    expect(verifyApiCreditSpendSignature(request)).toEqual({ ok: true });
    expect(verifyApiCreditSpendSignature({ ...request, method: "GET" })).toEqual({
      ok: false,
      error: "signature_mismatch",
    });
  });

  it("rejects a signature made over a different message entirely", () => {
    const keypair = Keypair.random();
    const nowMs = Date.now();
    const input = {
      walletAddress: keypair.publicKey(),
      apiId: "api1",
      method: "POST",
      path: "/api/api1/generate",
      timestamp: String(Math.floor(nowMs / 1000)),
      nonce: "nonce-sep53-000002",
      bodyHash: apiCreditRequestBodyHash(undefined),
    };
    const signature = keypair.sign(Buffer.from("unrelated")).toString("base64");

    expect(
      verifyApiCreditSpendSignature({ ...input, signature, nowMs, maxSkewMs: 300_000 }),
    ).toEqual({
      ok: false,
      error: "signature_mismatch",
    });
  });
});
