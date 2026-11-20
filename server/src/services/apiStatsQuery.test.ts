import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { statsPagination, statsWhere } from "./apiStatsQuery.js";

const dialect = new PgDialect();
const render = (where: ReturnType<typeof statsWhere>) => dialect.sqlToQuery(where);

describe("statsWhere (#143)", () => {
  it("filters only by API when no range is given", () => {
    const q = render(statsWhere("api1"));
    expect(q.sql).toContain('"api_calls"."api_id" = $1');
    expect(q.sql).not.toContain(">=");
    expect(q.sql).not.toContain(" < ");
    expect(q.params).toEqual(["api1"]);
  });

  it("uses an inclusive lower bound and an exclusive upper bound", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-02-01T00:00:00Z");
    const q = render(statsWhere("api1", { from, to }));
    expect(q.sql).toContain('"api_calls"."created_at" >= $2');
    expect(q.sql).toContain('"api_calls"."created_at" < $3');
    expect(q.params).toHaveLength(3);
  });

  it("treats since as an alias for from", () => {
    const since = new Date("2026-01-01T00:00:00Z");
    expect(render(statsWhere("api1", { since })).sql).toBe(
      render(statsWhere("api1", { from: since })).sql,
    );
  });

  it("prefers from over since when both are given", () => {
    const from = new Date("2026-03-01T00:00:00Z");
    const since = new Date("2026-01-01T00:00:00Z");
    const q = render(statsWhere("api1", { from, since }));
    expect(q.params).toHaveLength(2);
  });
});

describe("statsPagination", () => {
  it("reports more pages while offset + page < total", () => {
    expect(statsPagination(50, 0, 50, 120)).toEqual({
      limit: 50,
      offset: 0,
      total: 120,
      hasMore: true,
    });
    expect(statsPagination(50, 100, 20, 120).hasMore).toBe(false);
  });

  it("handles an empty range", () => {
    expect(statsPagination(50, 0, 0, 0)).toEqual({
      limit: 50,
      offset: 0,
      total: 0,
      hasMore: false,
    });
  });

  it("handles an offset past the end", () => {
    expect(statsPagination(10, 500, 0, 30).hasMore).toBe(false);
  });
});
