// Turns the dashboard's date pickers into a stats query (#143).
//
// The pickers are whole days and the "To" day is inclusive for people, while
// the API takes an exclusive upper bound. So "Jan 1 – Jan 31" becomes
// from=2026-01-01T00:00:00Z & to=2026-02-01T00:00:00Z (UTC days).

export const STATS_PAGE_SIZE = 50;
export const STATS_MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export type StatsRangeResult =
  { ok: true; from?: string; to?: string } | { ok: false; error: string };

function parseDay(value: string): number | null {
  if (!DAY_RE.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  // Reject rollovers such as 2026-02-31.
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

export function buildStatsRange(fromDay: string, toDay: string): StatsRangeResult {
  const from = fromDay ? parseDay(fromDay) : undefined;
  const toInclusive = toDay ? parseDay(toDay) : undefined;
  if (from === null) return { ok: false, error: "From is not a valid date." };
  if (toInclusive === null) return { ok: false, error: "To is not a valid date." };
  const to = toInclusive === undefined ? undefined : toInclusive + DAY_MS;
  if (from !== undefined && to !== undefined) {
    if (from >= to) return { ok: false, error: "From must be on or before To." };
    if (to - from > STATS_MAX_RANGE_DAYS * DAY_MS) {
      return { ok: false, error: `Pick a range of at most ${STATS_MAX_RANGE_DAYS} days.` };
    }
  }
  return {
    ok: true,
    from: from === undefined ? undefined : new Date(from).toISOString(),
    to: to === undefined ? undefined : new Date(to).toISOString(),
  };
}
