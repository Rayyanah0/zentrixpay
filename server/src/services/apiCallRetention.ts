import { inArray, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { apiCalls, apiDailyRollups, apiCallFinancialRecords } from "../db/schema.js";
import type * as schema from "../db/schema.js";

// Bounded retention for api_calls rows (#144, #283). Rows older than the retention
// window are rolled up daily into api_daily_rollups, charged financial records are
// preserved in api_call_financial_records, and then api_calls rows are deleted in
// batches; see docs/api-call-retention.md for which fields are kept.

type Db = PostgresJsDatabase<typeof schema>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Shortest non-zero retention: the provider time-series reaches back 90 days. */
export const MIN_API_CALL_RETENTION_DAYS = 90;

export interface PurgeOptions {
  /** Rows created before `now - retentionDays` are deleted. 0 disables purging. */
  retentionDays: number;
  /** Rows deleted per statement, so a large backlog never holds one long lock. */
  batchSize: number;
  /** Upper bound on statements per run; the rest is picked up by the next run. */
  maxBatches?: number;
  now?: Date;
}

/** The instant before which call records have expired. */
export function apiCallRetentionCutoff(now: Date, retentionDays: number): Date {
  return new Date(now.getTime() - retentionDays * DAY_MS);
}

/**
 * Delete expired api_calls rows after updating daily rollups and preserving
 * financial records for charged calls (#283). Returns how many rows were deleted.
 */
export async function purgeExpiredApiCalls(db: Db, opts: PurgeOptions): Promise<number> {
  if (opts.retentionDays <= 0) return 0;
  const cutoff = apiCallRetentionCutoff(opts.now ?? new Date(), opts.retentionDays);
  const maxBatches = opts.maxBatches ?? 100;

  let deleted = 0;
  for (let batch = 0; batch < maxBatches; batch++) {
    const expiredRows = await db
      .select()
      .from(apiCalls)
      .where(lt(apiCalls.createdAt, cutoff))
      .limit(opts.batchSize);

    if (expiredRows.length === 0) break;

    // 1. Keep minimal financial fields for charged calls (#283 Task 3)
    const chargedCalls = expiredRows.filter((r) => r.charged);
    if (chargedCalls.length > 0) {
      await db
        .insert(apiCallFinancialRecords)
        .values(
          chargedCalls.map((c) => ({
            id: String(c.id),
            apiId: String(c.apiId),
            payerAddress: c.payerAddress,
            amount: c.amount,
            txHash: c.txHash ?? null,
            refundStatus: c.refundStatus ?? null,
            refundAmount: c.refundAmount ?? null,
            refundTxHash: c.refundTxHash ?? null,
            refundedAt: c.refundedAt ?? null,
            createdAt: c.createdAt,
          })),
        )
        .onConflictDoNothing();
    }

    // 2. Aggregate into daily rollup table (#283 Task 1)
    const rollupsMap = new Map<
      string,
      {
        apiId: string;
        date: string;
        calls: number;
        chargedCalls: number;
        revenue: number;
        totalDurationMs: number;
        refundedCalls: number;
        refundedAmount: number;
        payers: Set<string>;
      }
    >();

    for (const r of expiredRows) {
      const dateStr = (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt))
        .toISOString()
        .slice(0, 10);
      const key = `${r.apiId}:${dateStr}`;
      let item = rollupsMap.get(key);
      if (!item) {
        item = {
          apiId: String(r.apiId),
          date: dateStr,
          calls: 0,
          chargedCalls: 0,
          revenue: 0,
          totalDurationMs: 0,
          refundedCalls: 0,
          refundedAmount: 0,
          payers: new Set<string>(),
        };
        rollupsMap.set(key, item);
      }
      item.calls += 1;
      item.totalDurationMs += r.durationMs ?? 0;
      if (r.charged) {
        item.chargedCalls += 1;
        item.revenue += Number(r.amount) || 0;
        if (r.payerAddress) item.payers.add(r.payerAddress);
      }
      if (r.refundStatus === "refunded") {
        item.refundedCalls += 1;
        item.refundedAmount += Number(r.refundAmount) || 0;
      }
    }

    for (const r of rollupsMap.values()) {
      const payersArray = Array.from(r.payers);
      await db
        .insert(apiDailyRollups)
        .values({
          apiId: r.apiId,
          date: r.date,
          calls: r.calls,
          chargedCalls: r.chargedCalls,
          revenue: r.revenue.toString(),
          uniquePayers: payersArray.length,
          totalDurationMs: r.totalDurationMs,
          refundedCalls: r.refundedCalls,
          refundedAmount: r.refundedAmount.toString(),
          payers: payersArray,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [apiDailyRollups.apiId, apiDailyRollups.date],
          set: {
            calls: sql`${apiDailyRollups.calls} + ${r.calls}`,
            chargedCalls: sql`${apiDailyRollups.chargedCalls} + ${r.chargedCalls}`,
            revenue: sql`(${apiDailyRollups.revenue}::numeric + ${r.revenue}::numeric)::text`,
            totalDurationMs: sql`${apiDailyRollups.totalDurationMs} + ${r.totalDurationMs}`,
            refundedCalls: sql`${apiDailyRollups.refundedCalls} + ${r.refundedCalls}`,
            refundedAmount: sql`(${apiDailyRollups.refundedAmount}::numeric + ${r.refundedAmount}::numeric)::text`,
            payers: sql`(
              SELECT coalesce(jsonb_agg(DISTINCT elem), '[]'::jsonb)
              FROM jsonb_array_elements_text(${apiDailyRollups.payers} || ${JSON.stringify(payersArray)}::jsonb) AS elem
            )`,
            uniquePayers: sql`(
              SELECT count(DISTINCT elem)::int
              FROM jsonb_array_elements_text(${apiDailyRollups.payers} || ${JSON.stringify(payersArray)}::jsonb) AS elem
            )`,
            updatedAt: new Date(),
          },
        });
    }

    // 3. Delete expired api_calls rows
    const expiredIds = expiredRows.map((r) => r.id);
    const deletedRows = await db
      .delete(apiCalls)
      .where(inArray(apiCalls.id, expiredIds as never[]))
      .returning({ id: apiCalls.id });

    deleted += deletedRows.length;
    if (expiredRows.length < opts.batchSize) break;
  }

  return deleted;
}
