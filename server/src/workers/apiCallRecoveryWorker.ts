import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { apiCallRecordsRecovered } from "../lib/metrics.js";
import { getApiCallRecorder } from "../services/apiService.js";

// Retries api_calls rows whose insert failed (#134). Inserts are idempotent on
// the call id, so overlapping runs across replicas sharing one outbox volume
// never duplicate a row.

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startApiCallRecoveryWorker(): void {
  if (config.API_CALL_RECOVERY_INTERVAL_MS <= 0) return;
  logger.info(
    {
      event: "api_call_recovery_worker_start",
      intervalMs: config.API_CALL_RECOVERY_INTERVAL_MS,
      outboxDir: config.API_CALL_OUTBOX_DIR,
    },
    "starting API call recovery worker",
  );
  void runApiCallRecovery();
  intervalHandle = setInterval(
    () => void runApiCallRecovery(),
    config.API_CALL_RECOVERY_INTERVAL_MS,
  );
  intervalHandle.unref?.();
}

export function stopApiCallRecoveryWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export async function runApiCallRecovery(): Promise<void> {
  try {
    const result = await getApiCallRecorder().recover();
    if (result.recovered > 0) apiCallRecordsRecovered.inc(result.recovered);
    if (result.recovered > 0 || result.failed > 0) {
      logger.info(
        { event: "api_call_recovery_run", ...result },
        "API call record recovery run finished",
      );
    }
  } catch (err) {
    logger.error({ event: "api_call_recovery_error", err }, "API call recovery run failed");
  }
}
