/**
 * Every HTTP route the server exposes, and the guard it is meant to sit behind.
 *
 * routeAuthInventory.test.ts walks the Express router stack built by
 * createApp() and fails when a route is missing from this list, when a listed
 * route no longer exists, or when a route's guard differs from what is
 * declared here. Adding a route therefore means deciding, in review, whether
 * it is public.
 *
 * Guards:
 *   public          — no authentication in the route chain
 *   apiKey          — apiKeyAuth (publisher x-api-key)
 *   walletSignature — walletSignatureAuth (signed by the wallet in :address)
 *   x402            — paid proxy surface (loadProxiedApi + x402 paywall)
 *
 * Keys are "<METHOD> <path>" exactly as registered with the router; routes
 * registered with router.all() use the method "ALL".
 */
export type RouteGuard = "public" | "apiKey" | "walletSignature" | "x402";

export const ROUTE_AUTH_INVENTORY: Readonly<Record<string, RouteGuard>> = {
  // Health and discovery
  "GET /health": "public",
  "GET /health/ready": "public",
  "GET /.well-known/x402": "public",
  "GET /openapi.json": "public",
  "GET /docs": "public",
  // Prometheus scrape: guarded inside the handler by METRICS_TOKEN (404 when unset).
  "GET /metrics": "public",

  // Publishers
  "POST /publishers": "public",
  "GET /publishers/wallet/:address": "public",
  "GET /publishers/me": "apiKey",
  "POST /publishers/me/rotate-key": "apiKey",
  "GET /publishers/me/analytics": "apiKey",
  "GET /publishers/me/apis": "apiKey",

  // Public catalog
  "GET /apis": "public",
  "GET /apis/:id": "public",
  "GET /apis/:id/openapi.json": "public",

  // API management (owner)
  "POST /apis/import/preview": "apiKey",
  "POST /apis/import": "apiKey",
  "POST /apis": "apiKey",
  "PATCH /apis/:id": "apiKey",
  "DELETE /apis/:id": "apiKey",
  "POST /apis/:id/verify-ownership": "apiKey",
  "POST /apis/:id/test-upstream": "apiKey",
  "GET /apis/:id/stats": "apiKey",
  "GET /apis/:id/stats/time-series": "apiKey",

  // Payer reads
  "GET /payers/:address/calls": "walletSignature",
  "GET /payers/:address/entitlements": "walletSignature",

  // Paid proxy
  "POST /api/:id/pass": "x402",
  "ALL /api/:id{/*path}": "x402",
};
