import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";

/**
 * Names of upstream headers that may carry provider secrets.
 * These are redacted from any logged request/header objects.
 */
const SECRET_HEADER_NAMES = [
  "x-api-key",
  "x-provider-key",
  "x-upstream-secret",
  "authorization",
  "proxy-authorization",
];

/**
 * Build the list of pino redaction paths for the configured secret headers.
 * Covers both `req.headers[...]` and bare `headers[...]` shapes, plus the
 * `upstreamHeader.value` / `upstreamQueryParam.value` fields in request bodies.
 */
function buildRedactPaths(): string[] {
  const paths: string[] = [];

  for (const name of SECRET_HEADER_NAMES) {
    paths.push(`req.headers['${name}']`);
    paths.push(`headers['${name}']`);
    paths.push(`request.headers['${name}']`);
  }

  paths.push("upstreamHeader.value");
  paths.push("upstreamQueryParam.value");
  paths.push("req.body.upstreamHeader.value");
  paths.push("req.body.upstreamQueryParam.value");
  paths.push("body.upstreamHeader.value");
  paths.push("body.upstreamQueryParam.value");

  return paths;
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: buildRedactPaths(),
    censor: "[REDACTED]",
  },
  mixin() {
    return {
      service: "server",
    };
  },
});

/**
 * Returns the shared logger instance. Provided as a function so callers can
 * import `getLogger` and call it without needing to reference the named export
 * directly (matches the usage pattern across the codebase).
 */
export function getLogger() {
  return logger;
}

// ── Request-scoped context ───────────────────────────────────────────────────

const requestIdStorage = new AsyncLocalStorage<string>();

/**
 * Run `fn` with `requestId` bound to the current async context. Any call to
 * `getLogger()` inside `fn` will include the request ID automatically.
 */
export function runWithRequestContext(requestId: string, fn: () => void): void {
  requestIdStorage.run(requestId, fn);
}

export default logger;
