# ADR 0002: Buffer upstream responses in memory instead of streaming them

| Field      | Value                                                           |
| ---------- | --------------------------------------------------------------- |
| **Status** | Accepted                                                        |
| **Date**   | 2026-11-20                                                      |
| **Issue**  | #252                                                            |
| **Code**   | `server/src/lib/upstreamClient.ts`, `server/src/routes/apis.ts` |

## Context

Under [0001](0001-settle-after-response.md), the gateway only knows whether to
charge once it knows the final status, and it must not release the body
before settlement succeeds. Once bytes reach the caller, they cannot be taken
back.

## Decision

`sendUpstream()` reads the whole upstream response into a `Buffer` and
returns it. Nothing is written to the caller until the upstream has finished
and the x402 middleware has settled. Limits keep memory use bounded:

| Setting                    | Default | Effect                                         |
| -------------------------- | ------- | ---------------------------------------------- |
| `PROXY_MAX_REQUEST_BODY`   | `5mb`   | Larger bodies rejected before the paywall ¹    |
| `PROXY_MAX_RESPONSE_BYTES` | 10 MiB  | Larger responses are aborted, 502, not charged |
| `PROXY_DEFAULT_TIMEOUT_MS` | 15 s    | Per-call upstream timeout, 504, not charged    |
| `PROXY_MAX_TIMEOUT_MS`     | 25 s    | Ceiling for a provider's own `timeoutMs`       |
| `REQUEST_TIMEOUT_MS`       | 30 s    | Whole-request timeout (503); kept above both   |

¹ `express.raw()` raises a 413 error, but the global error handler in
`app.ts` turns every error into a `500`. The caller is never asked to pay,
because the error happens before `apiPaywall`.

Request bodies are buffered too, with `express.raw()`, so they can be
forwarded unchanged. The JSON parser is skipped for `/api/*`.

## Options considered

- **Buffer (chosen)**: fits settle-after-response, and lets the gateway check
  the size before releasing anything.
- **Stream, settle up front**: lower latency and supports SSE and large
  downloads, but conflicts with 0001.
- **Stream, settle when the stream ends**: the caller would already have the
  data, so a failed settlement could not be enforced.

## Consequences

- Streaming APIs (SSE, chunked LLM output, long downloads) cannot be sold yet.
  The README lists this under "Not yet built".
- Time to first byte equals the full upstream time plus settlement.
- Worst-case memory is roughly (in-flight proxy calls) × (10 MiB response +
  5 MB request). Size instances, and set `PROXY_MAX_RESPONSE_BYTES`, with
  that in mind.
- If streaming is added later, it will need its own payment model, for
  example prepaid credits. That would be a new ADR superseding this one for
  streaming routes.
