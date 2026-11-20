# API-call record recovery

Every proxied call writes one row to `api_calls`, which drives provider stats, the payer receipts list and refunds. The paid request has already succeeded when the row is written, so a failed insert (database restart, failover, pool exhaustion) must not drop the call from usage stats.

## How it works

1. The proxy records the call with a stable id (the call id, which is also the `api_calls` primary key).
2. If the insert fails, the record is written to an on-disk outbox: one JSON file per call in `API_CALL_OUTBOX_DIR`, written via temp file + rename so a crash never leaves a partial entry.
3. A background worker retries due entries every `API_CALL_RECOVERY_INTERVAL_MS`, with exponential backoff per entry (1 s, doubling, capped at 5 min).
4. Inserts use `ON CONFLICT (id) DO NOTHING`, so retries are idempotent: if a row landed but its outbox entry was not yet removed, the next retry is a no-op and the entry is cleared.
5. Recovered rows keep their original call time, so they fall into the right stats window.

Only if the outbox itself cannot be written is the call logged as `api_call_record_lost`.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `API_CALL_OUTBOX_DIR` | `./data/api-call-outbox` | Spool directory. Mount a persistent volume in production so entries survive restarts. |
| `API_CALL_RECOVERY_INTERVAL_MS` | `30000` | Retry interval. `0` disables the worker (spooled entries wait for the next start). |

## Operational signal

| Metric | Type | Meaning |
| --- | --- | --- |
| `zentrixpay_api_call_records_pending` | gauge | Records spooled and awaiting recovery. Stats are behind while this is non-zero. |
| `zentrixpay_api_call_records_recovered_total` | counter | Records written by the recovery worker. |

Alert when `zentrixpay_api_call_records_pending > 0` for longer than a few recovery intervals. Each outbox file holds `attempts` and `lastError` for diagnosis.

Log events: `api_call_record_spooled`, `api_call_record_recovery_failed`, `api_call_recovery_run`, `api_call_record_lost`.
