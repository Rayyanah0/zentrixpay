import { describe, it, expect, vi, beforeEach } from "vitest";

// ── mock db ───────────────────────────────────────────────────────────────────

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../db/client.js", () => ({
  db: {
    select: () => ({ from: () => ({ where: mockSelect }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: mockUpdate }) }) }),
  },
}));

vi.mock("../config.js", () => ({
  config: {
    USDC_CONTRACT_ID: "CTEST_USDC_CONTRACT",
    NETWORK: "stellar:testnet",
    FACILITATOR_URL: "https://facilitator.example.test",
  },
}));

vi.mock("../lib/logger.js", () => ({
  getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockBuildInvocationTx = vi.fn().mockResolvedValue("unsigned-xdr");
const mockAssertSignedInvocation = vi.fn();

vi.mock("../lib/sorobanTx.js", () => ({
  buildInvocationTx: mockBuildInvocationTx,
  assertSignedInvocation: mockAssertSignedInvocation,
  SignedTxMismatchError: class SignedTxMismatchError extends Error {},
}));

const mockSubmitSignedTx = vi.fn();

vi.mock("./registryClient.js", () => ({
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  submitSignedTx: mockSubmitSignedTx,
}));

vi.mock("@zentrixpay/registry-client", () => ({
  usdcToBaseUnits: (v: string) => BigInt(Math.round(parseFloat(v) * 1_000_000)),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

import { prepareCallRefund, confirmCallRefund } from "./apiRefunds.js";
import type { ApiRow } from "./apiService.js";

function makeApi(overrides: Partial<ApiRow> = {}): ApiRow {
  return {
    id: 1,
    publisherId: "pub_1",
    name: "Test API",
    description: null,
    upstreamUrl: "https://upstream.example.com",
    price: "0.01",
    priceRules: [],
    walletAddress: "GCTEST_WALLET",
    allowedMethods: ["GET"],
    payerAllowlist: null,
    payerDenylist: [],
    upstreamHeaderName: null,
    upstreamHeaderValueEnc: null,
    upstreamQueryName: null,
    upstreamQueryValueEnc: null,
    openapiSpec: null,
    timeoutMs: null,
    maxResponseBytes: null,
    webhookUrl: null,
    webhookSecretEnc: null,
    healthPath: null,
    healthy: true,
    healthFailures: 0,
    lastHealthCheckAt: null,
    ownershipToken: "tok",
    ownershipVerifiedAt: null,
    listed: true,
    tags: [],
    passPrice: null,
    freeCallsPerDay: 0,
    archivedAt: null,
    createdAt: new Date(),
    onchainStatus: "none",
    onchainTxHash: null,
    streamingEnabled: false,
    network: null,
    ...overrides,
  } as unknown as ApiRow;
}

function makeCall(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    apiId: 1,
    method: "GET",
    path: "/test",
    statusCode: 200,
    charged: true,
    amount: "0.01",
    asset: "USDC",
    payer: "GCPAYER_ADDRESS",
    payerAddress: "GCPAYER_ADDRESS",
    txHash: "txhash",
    settlementTx: null,
    latencyMs: 100,
    durationMs: 100,
    requestHeaders: null,
    responseHeaders: null,
    error: null,
    refundStatus: null,
    refundAmount: null,
    refundTxHash: null,
    refundedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("prepareCallRefund", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns unsigned XDR and refund metadata for a charged call", async () => {
    const api = makeApi();
    const call = makeCall();
    mockSelect.mockResolvedValueOnce([call]);

    const result = await prepareCallRefund(api, String(call.id));

    expect(result.unsignedXdr).toBe("unsigned-xdr");
    expect(result.refund.callId).toBe(call.id);
    expect(result.refund.to).toBe("GCPAYER_ADDRESS");
    expect(result.refund.amount).toBe("0.01");
  });

  it("rejects when the call was not charged", async () => {
    const api = makeApi();
    const call = makeCall({ charged: false });
    mockSelect.mockResolvedValueOnce([call]);

    await expect(prepareCallRefund(api, String(call.id))).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("not charged"),
    });
  });

  it("rejects when the call is already refunded", async () => {
    const api = makeApi();
    const call = makeCall({ refundStatus: "refunded" });
    mockSelect.mockResolvedValueOnce([call]);

    await expect(prepareCallRefund(api, String(call.id))).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("already refunded"),
    });
  });
});

describe("confirmCallRefund", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits the signed XDR and returns the updated call row", async () => {
    const api = makeApi();
    const call = makeCall();
    const updatedCall = { ...call, refundStatus: "refunded", refundTxHash: "refund-tx" };

    // First select for refundableCall, second for the update returning
    mockSelect.mockResolvedValueOnce([call]).mockResolvedValueOnce([call]);
    mockUpdate
      .mockResolvedValueOnce([{ id: call.id }]) // claim
      .mockResolvedValueOnce([updatedCall]); // final update

    mockSubmitSignedTx.mockResolvedValueOnce({ success: true, txHash: "refund-tx" });

    const result = await confirmCallRefund(api, String(call.id), "signed-xdr");

    expect(mockSubmitSignedTx).toHaveBeenCalledWith("signed-xdr");
    expect(result).toMatchObject({ refundStatus: "refunded" });
  });

  it("rejects a double refund (call already claimed as pending)", async () => {
    const api = makeApi();
    const call = makeCall();

    // refundableCall sees the call as not yet refunded
    mockSelect.mockResolvedValueOnce([call]);
    // the UPDATE … WHERE refundStatus IS NULL returns nothing (another request claimed it)
    mockUpdate.mockResolvedValueOnce([]);

    await expect(confirmCallRefund(api, String(call.id), "signed-xdr")).rejects.toMatchObject({
      statusCode: 409,
      message: expect.stringContaining("in progress"),
    });

    expect(mockSubmitSignedTx).not.toHaveBeenCalled();
  });
});
