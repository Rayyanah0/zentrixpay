# Architecture decision records

Short records of the decisions behind the pay-per-call gateway (`/api/:id`).
Each one says what was decided, why, and what it costs. Before this folder
existed, these decisions were only written down in PR threads.

| ADR                                        | Decision                                                      | Status   |
| ------------------------------------------ | ------------------------------------------------------------- | -------- |
| [0001](0001-settle-after-response.md)      | Settle the payment only after the upstream has answered       | Accepted |
| [0002](0002-buffer-upstream-responses.md)  | Buffer upstream responses in memory instead of streaming them | Accepted |
| [0003](0003-cuid2-identifiers.md)          | Use cuid2 strings as primary keys                             | Accepted |
| [0004](0004-encrypted-upstream-secrets.md) | Encrypt providers' upstream secrets with AES-256-GCM          | Accepted |
| [0005](0005-ownership-proof-well-known.md) | Prove upstream ownership with a `/.well-known` file           | Accepted |
| [0006](0006-slim-api-registry-contract.md) | Anchor API prices in a slim `api-registry` contract           | Proposed |

Older ADRs from the MindVault vault (fee config, refund escrow, leases, tag
index repair) are still in [`docs/`](../) as `adr-*.md`.

## Writing a new ADR

Copy [`template.md`](template.md) to `NNNN-short-title.md`, using the next
free number. Keep it to one decision and about a page. An ADR is not edited
once it is accepted. If a decision changes, write a new ADR and set the old
one's status to `Superseded by NNNN`.
