import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { verifyPayeeSignature } from "../utils/payeeSignature.js";
import type { ApiRow } from "../services/apiService.js";

/**
 * In-memory store of payee-change signatures that have already been used.
 *
 * A payee-change signature is valid for up to SIGNATURE_MAX_SKEW_MS, so a
 * captured signature could otherwise be replayed within that window (e.g. to
 * switch the payee back after the owner reverted a change). We record each
 * accepted signature and reject any subsequent use until it would have
 * expired anyway.
 *
 * Keyed by the raw signature header; the value is the expiry timestamp (ms).
 */
const usedSignatures = new Map<string, number>();

function pruneUsedSignatures(nowMs: number): void {
  for (const [key, expiresAt] of usedSignatures) {
    if (expiresAt <= nowMs) {
      usedSignatures.delete(key);
    }
  }
}

/**
 * Enforces a payee-wallet signature when a PATCH /apis/:id request includes a
 * `walletAddress` change.
 *
 * If the request does not touch `walletAddress`, or the new address is
 * identical to the current one, this middleware is a no-op.
 *
 * When a change IS requested the caller must supply two extra headers:
 *   X-Payee-Timestamp  — unix timestamp in seconds (string)
 *   X-Payee-Signature  — base64 Ed25519 signature of the challenge message:
 *                        "zentrixpay:change-payee:<apiId>:<newAddress>:<timestamp>"
 *
 * The signature must be produced by the *current* payee wallet — i.e. the key
 * whose address is stored in api.walletAddress right now. This proves the
 * person requesting the change controls that wallet and prevents an API-key
 * holder from silently redirecting revenue.
 *
 * Each signature is single-use: once accepted it is recorded (with a TTL equal
 * to the clock-skew window) and any replay is rejected.
 *
 * The api row must be attached to res.locals.api before this middleware runs.
 * If it is missing, the request is rejected (fail closed) rather than skipping
 * the payee-signature check.
 */
export function payeeSignatureAuth(req: Request, res: Response, next: NextFunction): void {
  const body = req.body as Record<string, unknown>;
  const api = res.locals.api as ApiRow | undefined;

  // Only relevant for PATCH requests that include walletAddress
  if (!body || typeof body.walletAddress !== "string") {
    next();
    return;
  }

  // Fail closed: a walletAddress change requires the api row to verify against.
  if (!api) {
    res.status(500).json({ error: "API context not loaded" });
    return;
  }

  // If the address hasn't changed, no signature needed
  if (body.walletAddress === api.walletAddress) {
    next();
    return;
  }

  const newWalletAddress = body.walletAddress;
  const timestampHeader = req.headers["x-payee-timestamp"];
  const signatureHeader = req.headers["x-payee-signature"];

  if (!timestampHeader || typeof timestampHeader !== "string") {
    res.status(401).json({
      error: "Missing X-Payee-Timestamp header",
      hint: "Changing walletAddress requires a signature from the current payee wallet.",
    });
    return;
  }

  if (!signatureHeader || typeof signatureHeader !== "string") {
    res.status(401).json({
      error: "Missing X-Payee-Signature header",
      hint: "Changing walletAddress requires a signature from the current payee wallet.",
    });
    return;
  }

  const nowMs = Date.now();
  pruneUsedSignatures(nowMs);

  // Reject replays of an already-consumed signature.
  if (usedSignatures.has(signatureHeader)) {
    res.status(403).json({
      error: "X-Payee-Signature has already been used",
    });
    return;
  }

  const result = verifyPayeeSignature({
    currentPayeeAddress: api.walletAddress,
    apiId: api.id,
    newWalletAddress,
    timestampHeader,
    signatureHeader,
    nowMs,
    maxSkewMs: config.SIGNATURE_MAX_SKEW_MS,
  });

  if (!result.ok) {
    const messages: Record<string, string> = {
      invalid_timestamp: "X-Payee-Timestamp is not a valid unix timestamp",
      timestamp_expired: "X-Payee-Timestamp is outside the allowed clock-skew window",
      invalid_signature_encoding: "X-Payee-Signature must be base64-encoded (64 bytes when decoded)",
      invalid_public_key: "Current payee address is not a valid Stellar public key",
      signature_mismatch: "X-Payee-Signature is invalid for the current payee wallet",
    };
    res.status(403).json({
      error: messages[result.error!] ?? "Payee signature verification failed",
    });
    return;
  }

  // Mark the signature as consumed. It only needs to be remembered until the
  // timestamp would fall outside the skew window anyway.
  usedSignatures.set(signatureHeader, nowMs + config.SIGNATURE_MAX_SKEW_MS);

  next();
}
