# ADR 0006: A slim `api-registry` contract for API price anchoring

| Field      | Value                                        |
| ---------- | -------------------------------------------- |
| **Status** | Proposed                                     |
| **Date**   | 2026-11-23                                   |
| **Issue**  | #257                                         |
| **Code**   | `contract/contracts/api-registry/src/lib.rs` |

## Context

The gateway anchors API prices on-chain using `vault-registry`, which still carries
the whole vault feature set: leases, disputes, royalties, moderation, receipts
anchoring and more (131 public functions). The extra surface costs audit effort
and storage, and it keeps drifting from the generated bindings.

What the gateway actually calls:

| Caller                                                  | Contract function                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `server/src/services/apiOnchain.ts`                     | `register`, `set_price` (provider-signed)                                                                     |
| `server/src/lib/stellarRegistry.ts` (via `getResource`) | `get` (reads `price` and `creator`)                                                                           |
| `server/src/services/registryClient.ts`                 | `exists`, `count`, `list`, `delist`, `transfer_ownership` are exported but never called                       |
| `mcp/src/tools/registry.ts`, `mcp/src/tools/state.ts`   | `get`, `get_terms_hash`, `set_terms_hash`, but neither module is imported by the MCP server (vault leftovers) |

## Decision

Add a separate `api-registry` contract that keeps exactly the surface the gateway
uses: `register`, `set_price` and `get`, plus `exists` and `count` for diagnostics.
Function names, argument order, validation rules (id format, price bounds,
512-byte metadata) and error codes match `vault-registry`. The server's calls and
its `NotFound` mapping therefore stay the same; only the contract id and the
generated bindings change.

`register` keeps its `tags` argument for call compatibility and rejects a
non-empty list (`InvalidTag`), since the slim registry does not store tags.

`vault-registry` stays in the workspace unchanged until the switch is complete.

## Options considered

- **Separate slim contract (chosen)**: small, auditable, and builds and tests on its own.
- **Feature-gated `vault-registry` build**: keeps one crate, but `#[contractimpl]`
  exports every function in the impl block, so gating means splitting the impl and
  threading features through about 6,000 lines of shared code and 11,000 lines of tests.
- **Keep `vault-registry`**: no migration work, but it keeps the audit and drift cost.

## Consequences

- To finish the switch (not done in this change, because it needs `stellar-cli` and a deployment):
  1. build and deploy `api-registry`
  2. regenerate `packages/registry-client` bindings from it (`pnpm contract:bindings`)
  3. point `VAULT_REGISTRY_CONTRACT_ID` / the network preset at the new id
  4. re-anchor existing listings (`register`) on the new contract
- After the switch, the unused `registryClient.ts` helpers and the unreferenced MCP
  `tools/registry.ts` / `tools/state.ts` can be deleted, and `vault-registry` retired.
