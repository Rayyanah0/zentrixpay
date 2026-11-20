# ADR 0005: Prove upstream ownership with a `/.well-known` file

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| **Status** | Accepted                                                             |
| **Date**   | 2026-11-20                                                           |
| **Issue**  | #252                                                                 |
| **Code**   | `server/src/services/apiService.ts` (`verifyOwnership`, `updateApi`) |

## Context

Anyone can register an API, and the gateway pays the registering wallet.
Without a check, someone could put a price on another company's public API
(`api.example.com`), list it in the catalog, and collect payments for traffic
they don't serve or own. They could also point the gateway at a victim and
use paying callers to send traffic to it.

## Decision

An API is created **unlisted**. It can only be listed after the provider
proves control of the upstream's **origin**:

1. `POST /apis` returns a random token (16 bytes, hex) and the URL
   `https://<upstream-origin>/.well-known/zentrixpay.txt`.
2. The provider serves a file there containing the line
   `zentrixpay-verification=<token>`.
3. `POST /apis/:id/verify-ownership` fetches it with the same guarded client
   the proxy uses (no private addresses, no redirects, 5 s timeout, 64 KiB
   cap). It requires a `200` and an exact line match, then sets
   `ownership_verified_at` and `listed = true`.

Afterwards:

- Changing `upstreamUrl` to a **different origin** clears the verification
  and unlists the API. A path change on the same origin does not.
- `PATCH { listed: true }` on an unverified API returns `409`.

## Options considered

- **`/.well-known` file (chosen)**: one HTTP fetch, works with any host, and
  uses the same mechanism as ACME HTTP-01 and similar checks.
- **DNS TXT record**: stronger for apex domains, but slower to propagate and
  harder for providers on managed hosting. A good second method to add later.
- **Signed challenge response header**: requires the provider to change
  code, not just host a file.
- **Manual review**: does not scale and blocks self-serve.

## Consequences

- Proof is **origin-scoped**. Anyone who can publish a file at the root of a
  shared origin (some multi-tenant hosts) can verify any path on it.
- Proof is checked **once**. If the domain later changes hands, the API stays
  listed until its owner changes the origin. Periodic re-verification is a
  follow-up.
- Verification proves control of the domain, not that the provider owns the
  content behind it. Abuse reports still need an operator path (see the
  runbook entry [Upstream abuse](../operator-runbook.md#upstream-abuse)).
