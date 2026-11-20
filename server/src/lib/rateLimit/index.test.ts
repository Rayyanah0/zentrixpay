import { afterEach, describe, expect, it, vi } from "vitest";

const { logger } = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../config.js", () => ({
  config: { NODE_ENV: "production", REDIS_URL: undefined },
}));
vi.mock("../logger.js", () => ({ logger }));

import { createRateLimitStore } from "./index.js";
import { MemorySlidingWindowStore } from "./stores.js";

describe("createRateLimitStore", () => {
  afterEach(() => vi.clearAllMocks());

  it("warns when production rate limits use per-process memory", () => {
    expect(createRateLimitStore()).toBeInstanceOf(MemorySlidingWindowStore);
    expect(logger.warn).toHaveBeenCalledWith(
      { event: "rate_limit_store", backend: "memory" },
      expect.stringContaining("per instance"),
    );
  });
});
