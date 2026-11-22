import type { Request, RequestHandler } from "express";
import { createRateLimiter } from "./rateLimit.js";
import { getRateLimitStore } from "../lib/rateLimit/index.js";

// POST /apis/:id/verify-ownership makes outbound HTTP and DNS requests to the
// provider's domain on demand. Without a limit, a leaked or abusive provider
// key could use the gateway to hammer a third-party domain (#289). Mirrors the
// upstream-test limiter: over the limit the route answers 429 with
// Retry-After before any outbound request is made.

/** Verifications per provider per window, across all of its APIs. */
export const OWNERSHIP_VERIFY_PROVIDER_RATE_LIMIT_MAX = 10;
/** Verifications per provider per API per window. */
export const OWNERSHIP_VERIFY_API_RATE_LIMIT_MAX = 5;
export const OWNERSHIP_VERIFY_RATE_LIMIT_WINDOW_MS = 60_000;

function publisherId(req: Request): string {
  return req.publisher?.id ?? "anonymous";
}

export const ownershipVerifyProviderRateLimit: RequestHandler = createRateLimiter({
  store: getRateLimitStore(),
  max: OWNERSHIP_VERIFY_PROVIDER_RATE_LIMIT_MAX,
  windowMs: OWNERSHIP_VERIFY_RATE_LIMIT_WINDOW_MS,
  limiterName: "ownership_verify_publisher",
  keyGenerator: (req) => `verify-ownership:publisher:${publisherId(req)}`,
});

// Keyed by provider as well as API, so a caller probing ids it does not own
// cannot use up the real owner's budget for that API.
export const ownershipVerifyApiRateLimit: RequestHandler = createRateLimiter({
  store: getRateLimitStore(),
  max: OWNERSHIP_VERIFY_API_RATE_LIMIT_MAX,
  windowMs: OWNERSHIP_VERIFY_RATE_LIMIT_WINDOW_MS,
  limiterName: "ownership_verify_api",
  keyGenerator: (req) =>
    `verify-ownership:publisher:${publisherId(req)}:api:${String(req.params.id)}`,
});

/** Both limits, in the order they apply on the route. */
export const ownershipVerifyRateLimit: RequestHandler[] = [
  ownershipVerifyProviderRateLimit,
  ownershipVerifyApiRateLimit,
];
