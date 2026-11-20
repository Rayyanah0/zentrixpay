# ADR 0001: Settle the payment only after the upstream has answered

| Field      | Value                                                              |
| ---------- | ------------------------------------------------------------------ |
| **Status** | Accepted                                                           |
| **Date**   | 2026-11-20                                                         |
| **Issue**  | #252                                                               |
| **Code**   | `server/src/middleware/apiPaywall.ts`, `server/src/routes/apis.ts` |

## Context

A paid call has two parts: the caller's USDC payment and the provider's
upstream response. Either one can fail. If the gateway settled first, a
caller would pay for timeouts, 5xx errors and oversized responses, and the
only fix would be a refund flow. We did not want to build or run one.

## Decision

The payment is **verified** before the request is forwarded. It is
**settled** only after the proxy handler has produced its response, and only
when that response's status is **below 400**. For a status of 400 or higher,
the x402 middleware (`@x402/express` `paymentMiddleware`) cancels the
settlement, so the caller pays nothing.

The proxy maps its own failures to error statuses so they are never charged:

| Failure                                  | Status | Charged |
| ---------------------------------------- | ------ | ------- |
| Upstream answered 4xx/5xx                | as-is  | no      |
| Upstream blocked (non-public address)    | 502    | no      |
| Network error                            | 502    | no      |
| Response over `PROXY_MAX_RESPONSE_BYTES` | 502    | no      |
| Upstream timeout                         | 504    | no      |

Every call is written to `api_calls` on the response's `finish` event, with
`charged = statusCode < 400`.

The handler sends with `res.end()`, not `res.send()`. `send()` adds an ETag
and can turn a reply into a bodiless `304`. That would count as a successful,
charged call even though the caller got no body.

## Options considered

- **Settle after the response (chosen)**: callers never pay for failures, and
  no refund path is needed.
- **Settle before forwarding**: simpler and lets the gateway stream (see
  [0002](0002-buffer-upstream-responses.md)), but every failure would need a
  refund.
- **Settle first, refund on failure**: needs escrow or provider-signed
  refunds, plus a reconciliation job.

## Consequences

- The response has to be held until settlement finishes, which forces
  buffering ([0002](0002-buffer-upstream-responses.md)).
- **The provider carries the settlement risk.** By the time settlement runs,
  the upstream has already done the work. If settlement fails (for example,
  the facilitator is down), the provider served a call that was never paid
  for, and the caller does not get a 2xx.
- A provider whose API returns `200` with an error in the body still gets
  paid. Status codes are the contract, and providers should use them
  honestly.
- `charged` in `api_calls` is derived from the final status and is not read
  back from the chain. Reconciling it against on-chain transfers is a
  separate job.
