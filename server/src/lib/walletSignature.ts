import { createHash } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { isTimestampWithinSkew } from "../utils/requestSignature.js";

// Proof that a request comes from the holder of a Stellar wallet, used by
// read endpoints keyed on a payer address (entitlements, call history).
//
// The wallet signs this UTF-8 challenge:
//
//   zentrixpay:wallet-auth
//   <METHOD>
//   <path without query>
//   <walletAddress>
//   <timestampSeconds>
//
// Method and path bind the signature to one endpoint so it cannot be replayed
// against another; the timestamp limits replay to the clock-skew window.
//
// Wallets such as Freighter sign messages the SEP-53 way (an Ed25519 signature
// over sha256("Stellar Signed Message:\n" + message)), while SDK keypairs sign
// the raw bytes. Both forms are accepted.

const SEP53_PREFIX = "Stellar Signed Message:\n";

export function buildWalletAuthMessage(input: {
  method: string;
  path: string;
  walletAddress: string;
  timestamp: string;
}): string {
  return [
    "zentrixpay:wallet-auth",
    input.method.toUpperCase(),
    input.path,
    input.walletAddress,
    input.timestamp,
  ].join("\n");
}

export function sep53Digest(message: string): Buffer {
  return createHash("sha256")
    .update(Buffer.from(SEP53_PREFIX + message, "utf8"))
    .digest();
}

export type WalletSignatureError =
  | "invalid_wallet"
  | "invalid_timestamp"
  | "expired_timestamp"
  | "invalid_signature"
  | "signature_mismatch";

export function verifyWalletAuthSignature(input: {
  method: string;
  path: string;
  walletAddress: string;
  timestamp: string;
  signature: string;
  nowMs: number;
  maxSkewMs: number;
}): { ok: true } | { ok: false; error: WalletSignatureError } {
  if (!StrKey.isValidEd25519PublicKey(input.walletAddress)) {
    return { ok: false, error: "invalid_wallet" };
  }
  const keypair = Keypair.fromPublicKey(input.walletAddress);

  if (!/^\d{1,12}$/.test(input.timestamp)) {
    return { ok: false, error: "invalid_timestamp" };
  }
  if (!isTimestampWithinSkew(Number(input.timestamp), input.nowMs, input.maxSkewMs)) {
    return { ok: false, error: "expired_timestamp" };
  }

  const signature = Buffer.from(input.signature, "base64");
  if (
    signature.length !== 64 ||
    signature.toString("base64").replace(/=+$/, "") !== input.signature.replace(/=+$/, "")
  ) {
    return { ok: false, error: "invalid_signature" };
  }

  const message = buildWalletAuthMessage(input);
  try {
    if (keypair.verify(Buffer.from(message, "utf8"), signature)) return { ok: true };
    if (keypair.verify(sep53Digest(message), signature)) return { ok: true };
  } catch {
    // fall through
  }
  return { ok: false, error: "signature_mismatch" };
}
