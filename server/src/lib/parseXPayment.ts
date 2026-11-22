import { Buffer } from "buffer";

export interface ParseXPaymentResult {
  /** The paying wallet address, or undefined if none could be extracted. */
  payer: string | undefined;
  /** Human-readable error message when decoding or parsing failed. */
  parseError: string | undefined;
}

/**
 * Extracts the payer address from an x402 X-Payment / PAYMENT-SIGNATURE header.
 *
 * Supports:
 *  - EVM payloads (v1/v2): `payload.authorization.from`
 *  - Legacy Stellar payloads: `payload.authorization.address` / `clientAddress`
 *  - x402 v2 Stellar `exact` payloads: signed Soroban authorization entry.
 *
 * Always returns an object with `payer` and `parseError`; never throws.
 */
export function parsePayerFromXPayment(
  xPaymentHeader: string | undefined | null,
): ParseXPaymentResult {
  if (!xPaymentHeader || typeof xPaymentHeader !== "string") {
    return { payer: undefined, parseError: undefined };
  }

  const { value: decoded, error: decodeError } = decodeXPayment(xPaymentHeader);
  if (decodeError) {
    return { payer: undefined, parseError: decodeError };
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    return { payer: undefined, parseError: "Decoded header is not an object" };
  }

  const obj = decoded as Record<string, unknown>;

  // Priority order matches the test expectations:
  // 1. payload.authorization.from  (EVM exact scheme)
  // 2. payload.authorization.address  (legacy Stellar)
  // 3. clientAddress  (top-level legacy)
  // 4. payload.transaction present → Stellar XDR, skip (payer extracted elsewhere)
  const authorization = (obj.payload as any)?.authorization;
  if (authorization && typeof authorization === "object") {
    const from = (authorization as any).from;
    if (typeof from === "string" && from.length > 0) {
      return { payer: from, parseError: undefined };
    }
    const address = (authorization as any).address;
    if (typeof address === "string" && address.length > 0) {
      return { payer: address, parseError: undefined };
    }
  }

  // If the payload carries a transaction XDR there is no plain address here;
  // the caller (payer.ts) decodes the XDR itself.
  if ((obj.payload as any)?.transaction) {
    return { payer: undefined, parseError: undefined };
  }

  const clientAddress = obj.clientAddress;
  if (typeof clientAddress === "string" && clientAddress.length > 0) {
    return { payer: clientAddress, parseError: undefined };
  }

  return { payer: undefined, parseError: undefined };
}

function decodeXPayment(header: string): { value?: unknown; error?: string } {
  const trimmed = header.trim();
  if (!trimmed) {
    return { error: "Failed to decode: empty header" };
  }

  // Try base64 first (standard x402 encoding), then raw JSON.
  let base64Decoded: string | undefined;
  try {
    base64Decoded = Buffer.from(trimmed, "base64").toString("utf8");
  } catch {
    // not valid base64
  }

  const candidates = base64Decoded ? [base64Decoded, trimmed] : [trimmed];

  for (const candidate of candidates) {
    try {
      return { value: JSON.parse(candidate) };
    } catch {
      // try next
    }
  }

  return { error: "Failed to decode: not valid base64-encoded JSON" };
}
