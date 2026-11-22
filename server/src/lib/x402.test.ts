import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFacilitatorClient = { kind: "mock-facilitator-client" };
const mockResourceServer = { kind: "mock-resource-server", register: vi.fn() };
const mockRegister = vi.fn().mockReturnValue(mockResourceServer);

const createLoggingFacilitatorClient = vi.fn(() => mockFacilitatorClient);
const x402ResourceServer = vi.fn(() => ({ register: mockRegister }));
const ExactStellarScheme = vi.fn(function (this: unknown, net: string) {
  return { kind: "mock-exact-stellar-scheme", network: net };
});

vi.mock("./loggingFacilitator.js", () => ({
  createLoggingFacilitatorClient,
}));

vi.mock("@x402/core/server", () => ({
  x402ResourceServer,
}));

vi.mock("@x402/stellar/exact/server", () => ({
  ExactStellarScheme,
}));

vi.mock("../config.js", () => ({
  config: {
    FACILITATOR_URL: "https://facilitator.example.test",
    NETWORK: "stellar:testnet",
  },
}));

describe("x402 wiring", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRegister.mockReturnValue(mockResourceServer);
  });

  it("constructs the facilitator client with config.FACILITATOR_URL", async () => {
    await import("./x402.js");

    expect(createLoggingFacilitatorClient).toHaveBeenCalledTimes(1);
    expect(createLoggingFacilitatorClient).toHaveBeenCalledWith("https://facilitator.example.test");
  });

  it("builds the shared resource server from the facilitator client and registers the ExactStellarScheme for the configured network", async () => {
    await import("./x402.js");

    expect(x402ResourceServer).toHaveBeenCalledTimes(1);
    expect(x402ResourceServer).toHaveBeenCalledWith(mockFacilitatorClient);

    expect(ExactStellarScheme).toHaveBeenCalledTimes(1);
    expect(ExactStellarScheme).toHaveBeenCalledWith("stellar:testnet");

    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledWith(expect.anything());
  });

  it("exports the configured network", async () => {
    const mod = await import("./x402.js");

    expect(mod.network).toBe("stellar:testnet");
  });

  it("exports sharedX402ResourceServer", async () => {
    const mod = await import("./x402.js");

    // sharedX402ResourceServer is the return value of x402ResourceServer(...)
    // which in the mock is the object returned by the vi.fn().
    expect(mod.sharedX402ResourceServer).toBeDefined();
  });
});
