# ADR 0004: Encrypt providers' upstream secrets with AES-256-GCM

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| **Status** | Accepted                                                             |
| **Date**   | 2026-11-20                                                           |
| **Issue**  | #252                                                                 |
| **Code**   | `server/src/utils/secretBox.ts`, `server/src/services/apiService.ts` |

## Context

Providers lock their upstream down by requiring a secret header (their own
API key). The proxy adds that header to every forwarded call, so it needs
the plaintext at call time. A plain hash will not work. Storing the value in
plaintext would turn any database leak (backup, replica, SQL injection,
Supabase dashboard access) into a leak of every provider's API.

## Decision

- The value is encrypted with **AES-256-GCM** using a 32-byte server key,
  `UPSTREAM_SECRET_KEY` (64 hex chars), and stored in
  `apis.upstream_header_value_enc` as `v1:<iv>:<tag>:<ciphertext>`
  (base64 parts, random 12-byte IV per value).
- The header **name** is stored in plaintext, lowercased.
- The value is **never returned** by any endpoint. Owners only see
  `hasUpstreamSecret: true`.
- If `UPSTREAM_SECRET_KEY` is not set, registering or updating a secret
  returns `503`. The server never stores the value unencrypted.
- The value is decrypted per request in `proxyHandler`, just before
  forwarding.

## Options considered

- **App-level AES-GCM with an env key (chosen)**: no new infrastructure, and
  GCM detects tampering. The `v1` prefix leaves room to change the format
  later.
- **Postgres `pgcrypto`**: the key would travel in SQL and show up in query
  logs.
- **External KMS / Vault**: the right long-term home for the key, but adds a
  network dependency to every paid call. Could be added later to wrap
  `UPSTREAM_SECRET_KEY` itself.
- **Plaintext**: rejected.

## Consequences

- **`UPSTREAM_SECRET_KEY` is the single point of failure.** If it is lost,
  every stored secret is unrecoverable. If it leaks along with a database
  copy, every secret is exposed. See the runbook entry
  [Lost `UPSTREAM_SECRET_KEY`](../operator-runbook.md#lost-upstream_secret_key).
- There is no key rotation yet. `decryptSecret` only knows one key, so
  rotating means re-encrypting every row in one pass. A key id in the
  version prefix (`v2:<kid>:…`) would allow gradual rotation.
- If the key is **unset** at runtime, the proxy skips adding the header and
  still forwards the call. A locked-down upstream will reject it, so the call
  is not charged. If the key is **wrong**, decryption throws, the request
  fails with 500, and the call is not charged.
