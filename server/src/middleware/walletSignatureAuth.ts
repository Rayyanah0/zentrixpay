import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { verifyWalletAuthSignature } from "../lib/walletSignature.js";
import { getRequestPath } from "../utils/requestSignature.js";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_wallet: "address must be a Stellar public key (G...)",
  invalid_timestamp: "X-Wallet-Timestamp must be a unix timestamp in seconds",
  expired_timestamp: "X-Wallet-Timestamp is outside the allowed clock-skew window",
  invalid_signature: "X-Wallet-Signature must be a base64 Ed25519 signature (64 bytes)",
  signature_mismatch: "X-Wallet-Signature does not match the wallet",
};

/**
 * Requires the request to be signed by the wallet named in `:address`.
 *
 * Headers:
 *   X-Wallet-Timestamp  unix seconds
 *   X-Wallet-Signature  base64 Ed25519 signature of buildWalletAuthMessage()
 *
 * See lib/walletSignature.ts for the signed challenge.
 */
export function walletSignatureAuth(req: Request, res: Response, next: NextFunction): void {
  const walletAddress = req.params.address;
  if (typeof walletAddress !== "string" || !/^G[A-Z2-7]{55}$/.test(walletAddress)) {
    res.status(400).json({ error: ERROR_MESSAGES.invalid_wallet });
    return;
  }

  const timestamp = req.headers["x-wallet-timestamp"];
  const signature = req.headers["x-wallet-signature"];
  if (typeof timestamp !== "string" || typeof signature !== "string") {
    res.status(401).json({
      error: "X-Wallet-Timestamp and X-Wallet-Signature headers are required",
      hint: "Sign the wallet-auth challenge with the wallet whose data you are reading.",
    });
    return;
  }

  const path = getRequestPath(req.originalUrl).split("?")[0];
  const result = verifyWalletAuthSignature({
    method: req.method,
    path,
    walletAddress,
    timestamp,
    signature,
    nowMs: Date.now(),
    maxSkewMs: config.SIGNATURE_MAX_SKEW_MS,
  });
  if (!result.ok) {
    res.status(401).json({ error: ERROR_MESSAGES[result.error] });
    return;
  }

  res.locals.walletAddress = walletAddress;
  next();
}
