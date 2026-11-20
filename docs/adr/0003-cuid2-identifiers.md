# ADR 0003: Use cuid2 strings as primary keys

| Field      | Value                     |
| ---------- | ------------------------- |
| **Status** | Accepted                  |
| **Date**   | 2026-11-20                |
| **Issue**  | #252                      |
| **Code**   | `server/src/db/schema.ts` |

## Context

An API's id is part of its public proxy URL (`/api/<id>`) and its catalog URL
(`/apis/<id>`). Unlisted APIs are reachable by id from management routes.
Call records (`api_calls`) are written on every proxied request. The id
scheme affects what the URLs reveal and how easily records can be guessed.

## Decision

Every table uses a `text` primary key generated in the application with
`createId()` from `@paralleldrive/cuid2`:

```ts
id: text("id").primaryKey().$defaultFn(() => createId()),
```

Owner-only lookups (`getOwnedApi`) return `404`, not `403`, when the caller
does not own the id, so an id's existence is never confirmed to anyone else.

## Options considered

- **cuid2 (chosen)**: not sequential and hard to guess, URL-safe and short (24
  chars), collision-resistant, and created without a database round trip.
- **`serial` / `bigserial`**: anyone can enumerate APIs, and the ids reveal
  how many APIs and calls exist.
- **UUID v4**: also fine, but longer and less pleasant in URLs. We wanted
  one scheme everywhere.
- **UUID v7 / ULID**: sortable by time, but the timestamp prefix leaks
  creation time.

## Consequences

- Ids are not sortable by time. Ordering always uses `created_at`, which has
  indexes for the hot paths (`idx_apis_listed_created_at`,
  `idx_api_calls_api_id_created_at`).
- An id is hard to guess, but it is not a secret. Unlisted APIs return 404
  on the proxy because of the `listed` check, not because the id is hidden.
- Random keys spread inserts across the B-tree index. At the current table
  sizes this does not matter. If `api_calls` grows large, partition it by
  time; do not switch the id scheme.
