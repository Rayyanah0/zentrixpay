/**
 * Safe response-header metadata for the zentrixpay_call tool (#146).
 *
 * The call tool returns the upstream status, body and content type. Clients
 * also need a little extra metadata (pagination links, retry hints, caching
 * validators, rate-limit counters) to use paid APIs well. Upstream headers are
 * untrusted, so only an explicit allowlist is passed through; everything else
 * is dropped.
 *
 * Never returned, even if an entry is added to the allowlist by mistake:
 *   - cookies (`set-cookie`, `set-cookie2`)
 *   - hop-by-hop headers (`connection`, `keep-alive`, `transfer-encoding`, ...)
 *   - x402 payment challenge / settlement headers (`payment-required`,
 *     `x-payment-response`, `www-authenticate`, ...); settlement is already
 *     reported as `txHash`.
 */

/** Exact header names (lower-case) that are safe to return to MCP clients. */
export const SAFE_RESPONSE_HEADERS: readonly string[] = [
  // Pagination
  "link",
  "x-total-count",
  "x-next-cursor",
  "x-page",
  "x-per-page",
  "x-total-pages",
  // Retry / rate limiting
  "retry-after",
  "ratelimit",
  "ratelimit-policy",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  // Caching / content description
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "content-language",
  "content-length",
  // Correlation
  "x-request-id",
];

/** Headers that must never be returned, regardless of the allowlist. */
export const BLOCKED_RESPONSE_HEADERS: readonly string[] = [
  // Cookies
  "set-cookie",
  "set-cookie2",
  // Hop-by-hop (RFC 9110 §7.6.1)
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  // Payment challenge / settlement
  "www-authenticate",
  "payment-required",
  "payment-response",
  "x-payment",
  "x-payment-required",
  "x-payment-response",
];

const ALLOWED = new Set(SAFE_RESPONSE_HEADERS);
const BLOCKED = new Set(BLOCKED_RESPONSE_HEADERS);

/** Maximum characters kept per header value, to bound tool output. */
export const MAX_HEADER_VALUE_CHARS = 1_024;

/**
 * Return the allowlisted subset of `headers` as a plain object with lower-case
 * keys. Headers listed in the `Connection` header (dynamic hop-by-hop headers)
 * are dropped too.
 */
export function pickSafeResponseHeaders(headers: Headers): Record<string, string> {
  const dynamicHopByHop = new Set(
    (headers.get("connection") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );

  const result: Record<string, string> = {};
  headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (!ALLOWED.has(name) || BLOCKED.has(name) || dynamicHopByHop.has(name)) return;
    result[name] =
      value.length > MAX_HEADER_VALUE_CHARS ? value.slice(0, MAX_HEADER_VALUE_CHARS) : value;
  });
  return result;
}
