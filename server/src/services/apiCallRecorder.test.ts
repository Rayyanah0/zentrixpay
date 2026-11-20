import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileApiCallRecordOutbox,
  createApiCallRecorder,
  type ApiCallRecord,
  type ApiCallRecordStore,
} from "./apiCallRecorder.js";

// #134: a failed api_calls insert is spooled durably, retried idempotently and
// reported as pending until it lands.

function record(callId = "call-1"): ApiCallRecord {
  return {
    callId,
    apiId: "api1",
    payerAddress: "GPAYER",
    amount: "0.01",
    charged: true,
    method: "GET",
    path: "/weather",
    responseStatus: 200,
    durationMs: 42,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/** In-memory api_calls table keyed by id (ON CONFLICT DO NOTHING semantics). */
function flakyStore() {
  const rows = new Map<string, ApiCallRecord>();
  const state = { down: false, inserts: 0 };
  const store: ApiCallRecordStore = {
    async insert(r) {
      state.inserts++;
      if (state.down) throw new Error("connection refused");
      if (!rows.has(r.callId)) rows.set(r.callId, r);
    },
  };
  return { store, rows, state };
}

describe("API call recorder (#134)", () => {
  let dir: string;
  let clock: number;
  let pending: number[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "zp-outbox-"));
    clock = 1_000_000;
    pending = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function setup() {
    const db = flakyStore();
    const outbox = new FileApiCallRecordOutbox(dir);
    const recorder = createApiCallRecorder({
      store: db.store,
      outbox,
      baseDelayMs: 1_000,
      maxDelayMs: 8_000,
      now: () => clock,
      onPending: (n) => pending.push(n),
    });
    return { ...db, outbox, recorder };
  }

  it("writes straight to the database when it is healthy", async () => {
    const { recorder, rows } = setup();
    expect(await recorder.record(record())).toBe("stored");
    expect(rows.size).toBe(1);
    expect(await recorder.pending()).toBe(0);
  });

  it("spools a failed write and recovers it once the database is back", async () => {
    const { recorder, rows, state } = setup();
    state.down = true;

    expect(await recorder.record(record())).toBe("spooled");
    expect(rows.size).toBe(0);
    expect(await readdir(dir)).toEqual(["call-1.json"]);
    expect(pending.at(-1)).toBe(1);

    state.down = false;
    clock += 1_000;
    expect(await recorder.recover()).toEqual({ recovered: 1, failed: 0, pending: 0 });
    expect(rows.get("call-1")).toEqual(record());
    expect(await readdir(dir)).toEqual([]);
    expect(pending.at(-1)).toBe(0);
  });

  it("keeps the original call time on recovered rows", async () => {
    const { recorder, rows, state } = setup();
    state.down = true;
    await recorder.record(record());
    state.down = false;
    clock += 60_000;
    await recorder.recover();
    expect(rows.get("call-1")?.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("backs off between failed recovery attempts", async () => {
    const { recorder, state } = setup();
    state.down = true;
    await recorder.record(record());

    // Not due yet: no attempt is made.
    const before = state.inserts;
    expect(await recorder.recover()).toEqual({ recovered: 0, failed: 0, pending: 1 });
    expect(state.inserts).toBe(before);

    clock += 1_000;
    expect(await recorder.recover()).toMatchObject({ failed: 1, pending: 1 });
    const [entry] = await new FileApiCallRecordOutbox(dir).list();
    expect(entry.attempts).toBe(2);
    expect(entry.lastError).toBe("connection refused");
    expect(entry.nextAttemptAt).toBe(clock + 2_000);
  });

  it("is idempotent when a retry repeats an insert that already landed", async () => {
    const { recorder, rows, state, outbox } = setup();
    state.down = true;
    await recorder.record(record());
    state.down = false;

    // Simulate a crash after the row was written but before the spool entry
    // was removed: the row exists and the entry is still pending.
    rows.set("call-1", record());
    clock += 1_000;
    expect(await recorder.recover()).toMatchObject({ recovered: 1, pending: 0 });
    expect(rows.size).toBe(1);
    expect(await outbox.list()).toEqual([]);
  });

  it("does not duplicate a call that is spooled twice", async () => {
    const { recorder, state, outbox } = setup();
    state.down = true;
    await recorder.record(record());
    await recorder.record(record());
    expect(await outbox.list()).toHaveLength(1);
  });

  it("reports how many records are waiting", async () => {
    const { recorder, state } = setup();
    state.down = true;
    await recorder.record(record("a"));
    await recorder.record(record("b"));
    expect(await recorder.pending()).toBe(2);
    expect(pending.at(-1)).toBe(2);
  });

  it("rejects call ids that could escape the outbox directory", async () => {
    const outbox = new FileApiCallRecordOutbox(dir);
    await expect(
      outbox.put({ record: record("../evil"), attempts: 1, nextAttemptAt: 0 }),
    ).rejects.toThrow(/invalid call id/);
  });

  it("treats a missing outbox directory as empty", async () => {
    const outbox = new FileApiCallRecordOutbox(join(dir, "missing"));
    expect(await outbox.list()).toEqual([]);
  });
});
