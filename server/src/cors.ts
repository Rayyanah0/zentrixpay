import cors, { type CorsOptions } from "cors";
import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

/** Headers clients may send for x402 payment retries and API auth. */
export const X402_ALLOWED_HEADERS = [
  "Content-Type",
  "Authorization",
  "x-api-key",
  "x-timestamp",
  "x-signature",
  "Idempotency-Key",
  "x-request-id",
  "PAYMENT-SIGNATURE",
  "X-Payment",
] as const;

/** Headers the server exposes for x402 flows and payment receipts. */
export const X402_EXPOSED_HEADERS = [
  "PAYMENT-REQUIRED",
  "PAYMENT-RESPONSE",
  "X-PAYMENT-RESPONSE",
  "x-request-id",
  "X-Payment-Id",
  "X-Payment-Amount",
  "X-Payment-Recipient",
] as const;

export function parseAllowedOrigins(raw: string | undefined, fallback: string): string[] {
  if (raw?.trim()) {
    return raw
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return [fallback];
}

export function createCorsOptions(): CorsOptions {
  const isProduction = config.NODE_ENV === "production";
  const allowedOrigins = parseAllowedOrigins(config.ALLOWED_ORIGINS, config.WEB_APP_URL);

  const origin: CorsOptions["origin"] = isProduction
    ? (
        requestOrigin: string | undefined,
        callback: (err: Error | null, allow?: boolean) => void,
      ) => {
        // Non-browser clients (curl, server-side fetch) omit Origin.
        if (!requestOrigin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(requestOrigin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin ${requestOrigin} is not allowed by CORS`));
      }
    : true;

  return {
    origin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [...X402_ALLOWED_HEADERS],
    exposedHeaders: isProduction ? [...X402_EXPOSED_HEADERS] : "*",
  };
}

/**
 * Returns a middleware that applies CORS. For API proxy paths
 * (`/api/<slug>/…`) it reflects only the headers the client requested, so
 * upstream-specific headers are not blocked. All other routes use the
 * configured x402 allowlist.
 */
export function corsMiddleware() {
  const baseOptions = createCorsOptions();

  // Pre-build the two variants to avoid rebuilding on every request.
  const standardCors = cors(baseOptions);
  const isProduction = config.NODE_ENV === "production";

  return (req: Request, res: Response, next: NextFunction) => {
    if (isProduction && /^\/api\/[^/]+(?:\/|$)/.test(req.path)) {
      const requested = req.headers["access-control-request-headers"];
      const reflectedHeaders =
        typeof requested === "string"
          ? requested
              .split(",")
              .map((h) => h.trim())
              .filter(Boolean)
          : [];
      const proxyCors = cors({ ...baseOptions, allowedHeaders: reflectedHeaders });
      return proxyCors(req, res, next);
    }
    return standardCors(req, res, next);
  };
}
