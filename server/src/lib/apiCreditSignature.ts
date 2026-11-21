import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import {
  EMPTY_BODY_HASH,
  hashRequestBody,
  isTimestampWithinSkew,
} from "../utils/requestSignature.js";

export function apiCreditRequestBodyHash(body: Buffer | undefined): string {
  return body ? hashRequestBody(body) : EMPTY_BODY_HASH;
}

/**
 * Prefix used by SEP-53 ("Stellar Signed Message"). Browser wallets such as
 * Freighter's signMessage sign sha256(prefix + message) rather than the raw
 * message, so both forms are accepted for the same message text.
 */
export const SEP53_MESSAGE_PREFIX = "Stellar Signed Message:\n";

/** SEP-53 digest of a message: sha256("Stellar Signed Message:\n" + message). */
export function sep53MessageDigest(message: Buffer): Buffer {
  return createHash("sha256")
    .update(Buffer.from(SEP53_MESSAGE_PREFIX, "utf8"))
    .update(message)
    .digest();
}

/**
 * The signed credit-spend message. Clients sign this exact text, either raw
 * (ed25519 over the bytes) or per SEP-53 (ed25519 over sha256 of the prefixed
 * bytes, as wallets do). Fields are joined with "\n" in this order.
 */
export function buildApiCreditSpendMessage(input: {
  walletAddress: string;
  apiId: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string {
  return [
    "zentrixpay:api-credit-spend",
    input.walletAddress,
    input.apiId,
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    input.bodyHash,
  ].join("\n");
}

export type ApiCreditSignatureError =
  | "invalid_wallet"
  | "invalid_timestamp"
  | "expired_timestamp"
  | "invalid_nonce"
  | "invalid_signature"
  | "signature_mismatch";

export function verifyApiCreditSpendSignature(input: {
  walletAddress: string;
  apiId: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
  signature: string;
  nowMs: number;
  maxSkewMs: number;
}): { ok: true } | { ok: false; error: ApiCreditSignatureError } {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromPublicKey(input.walletAddress);
  } catch {
    return { ok: false, error: "invalid_wallet" };
  }

  const timestamp = Number(input.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, error: "invalid_timestamp" };
  }
  if (!isTimestampWithinSkew(timestamp, input.nowMs, input.maxSkewMs)) {
    return { ok: false, error: "expired_timestamp" };
  }
  if (!/^[A-Za-z0-9._~-]{16,128}$/.test(input.nonce)) {
    return { ok: false, error: "invalid_nonce" };
  }

  const signature = Buffer.from(input.signature, "base64");
  if (
    signature.length !== 64 ||
    signature.toString("base64").replace(/=+$/, "") !== input.signature.replace(/=+$/, "")
  ) {
    return { ok: false, error: "invalid_signature" };
  }

  const messageBytes = Buffer.from(buildApiCreditSpendMessage(input), "utf8");
  try {
    const valid =
      keypair.verify(messageBytes, signature) ||
      keypair.verify(sep53MessageDigest(messageBytes), signature);
    return valid ? { ok: true } : { ok: false, error: "signature_mismatch" };
  } catch {
    return { ok: false, error: "signature_mismatch" };
  }
}

export function apiCreditPurchaseReference(transaction: string | undefined, paymentHeader: string) {
  if (transaction) return transaction;
  return `payment:${createHash("sha256").update(paymentHeader).digest("hex")}`;
}
