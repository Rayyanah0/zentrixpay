import { describe, it, expect } from "vitest";
import { overallReadinessStatus } from "./readiness.js";

describe("overallReadinessStatus", () => {
  it("returns ok when every dependency is healthy", () => {
    expect(
      overallReadinessStatus({
        database: { status: "ok", latencyMs: 1 },
        sorobanRpc: { status: "ok", latencyMs: 2 },
      }),
    ).toBe("ok");
  });

  it("returns error when any dependency fails", () => {
    expect(
      overallReadinessStatus({
        database: { status: "ok", latencyMs: 1 },
        sorobanRpc: {
          status: "error",
          latencyMs: 2,
          error: "soroban_rpc_unavailable",
        },
      }),
    ).toBe("error");
  });
});

describe("overallReadinessStatus with optional checks (#133)", () => {
  it("ignores failing checks that are not required", () => {
    expect(
      overallReadinessStatus({
        database: { status: "ok", latencyMs: 1 },
        facilitator: {
          status: "error",
          latencyMs: 2,
          required: false,
          error: "payment_facilitator_unavailable",
        },
      }),
    ).toBe("ok");
  });

  it("fails when a required facilitator check fails", () => {
    expect(
      overallReadinessStatus({
        database: { status: "ok", latencyMs: 1 },
        facilitator: {
          status: "error",
          latencyMs: 2,
          required: true,
          error: "payment_facilitator_unavailable",
        },
      }),
    ).toBe("error");
  });
});
