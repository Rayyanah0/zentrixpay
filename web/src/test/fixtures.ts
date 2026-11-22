/**
 * Shared test factories for API fixtures.
 *
 * When `PublicApi` or `OwnerApi` gains a field, add its default here once
 * instead of patching every test file that builds a fixture by hand.
 */
import type { OwnerApi, PublicApi } from "../api/apis.js";

export function makePublicApi(overrides: Partial<PublicApi> = {}): PublicApi {
  return {
    id: "api1",
    name: "Weather API",
    description: "Forecasts for any city",
    price: "0.01",
    priceRules: [],
    currency: "USDC",
    walletAddress: "GPROVIDER",
    allowedMethods: ["GET", "POST"],
    tags: ["weather"],
    healthy: true,
    proxyUrl: "http://gw.test/api/api1",
    openapiUrl: null,
    onchain: { registered: false, contractId: "", txHash: null },
    createdAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

export function makeOwnerApi(overrides: Partial<OwnerApi> = {}): OwnerApi {
  return {
    ...makePublicApi(),
    upstreamUrl: "https://api.example.com/v1",
    upstreamHeaderName: null,
    hasUpstreamSecret: false,
    upstreamQueryParamName: null,
    hasUpstreamQuerySecret: false,
    timeoutMs: null,
    maxResponseBytes: null,
    webhookUrl: null,
    hasWebhookSecret: false,
    healthPath: null,
    health: { healthy: true, consecutiveFailures: 0, lastCheckedAt: null },
    listed: false,
    onchainStatus: "none",
    ownershipVerified: false,
    ownershipVerification: {
      url: "https://api.example.com/.well-known/zentrixpay.txt",
      expectedContent: "zentrixpay-verification=abc",
    },
    ...overrides,
  };
}
