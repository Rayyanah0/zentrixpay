import { describe, expect, it } from "vitest";
import { STATS_MAX_RANGE_DAYS, buildStatsRange } from "./statsRange.js";

describe("buildStatsRange (#143)", () => {
  it("returns an open range when both fields are empty", () => {
    expect(buildStatsRange("", "")).toEqual({ ok: true, from: undefined, to: undefined });
  });

  it("makes the To day inclusive by sending the next midnight as an exclusive bound", () => {
    expect(buildStatsRange("2026-01-01", "2026-01-31")).toEqual({
      ok: true,
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-02-01T00:00:00.000Z",
    });
  });

  it("accepts a single-day range", () => {
    expect(buildStatsRange("2026-03-05", "2026-03-05")).toMatchObject({ ok: true });
  });

  it("rejects From after To", () => {
    expect(buildStatsRange("2026-02-02", "2026-02-01")).toMatchObject({ ok: false });
  });

  it("enforces the maximum range length", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const lastOk = new Date(from.getTime() + (STATS_MAX_RANGE_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const tooFar = new Date(from.getTime() + STATS_MAX_RANGE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(buildStatsRange("2026-01-01", lastOk)).toMatchObject({ ok: true });
    expect(buildStatsRange("2026-01-01", tooFar)).toMatchObject({ ok: false });
  });

  it("rejects malformed and impossible dates", () => {
    expect(buildStatsRange("2026-02-31", "")).toMatchObject({ ok: false });
    expect(buildStatsRange("", "01/02/2026")).toMatchObject({ ok: false });
  });
});
