import { and, gte, lt, sql, type SQL } from "drizzle-orm";
import { apiCalls } from "../db/schema.js";

// Shared time window for API stats (#143). Kept free of config and the DB
// client so the filter can be unit-tested without a database.

/**
 * Optional time window for stats. `from` is inclusive and `to` exclusive, so
 * back-to-back windows never count the same call twice. `since` is accepted as
 * an alias for `from` for older callers.
 */
export interface StatsRange {
  from?: Date;
  to?: Date;
  since?: Date;
}

export interface RecentCallsOptions extends StatsRange {
  limit: number;
  offset?: number;
}

/**
 * WHERE clause shared by the aggregates and the call history, so both always
 * describe exactly the same set of calls.
 */
export function statsWhere(apiId: string, range: StatsRange = {}): SQL {
  const from = range.from ?? range.since;
  // API ids are text in the database; compare without a column-type cast.
  const conditions: SQL[] = [sql`${apiCalls.apiId} = ${apiId}`];
  if (from) conditions.push(gte(apiCalls.createdAt, from));
  if (range.to) conditions.push(lt(apiCalls.createdAt, range.to));
  return and(...conditions)!;
}

/** Pagination block returned alongside the call history. */
export function statsPagination(
  limit: number,
  offset: number,
  returned: number,
  total: number,
): { limit: number; offset: number; total: number; hasMore: boolean } {
  return { limit, offset, total, hasMore: offset + returned < total };
}
