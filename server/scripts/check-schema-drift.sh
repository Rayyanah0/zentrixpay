#!/usr/bin/env bash
# Detects drift between server/src/db/schema.ts and the SQL migrations (#189).
#
# Builds the database twice, from scratch:
#   1. "migrations" — applies every migration in server/drizzle/ (drizzle-kit migrate)
#   2. "schema"     — creates objects straight from schema.ts (drizzle-kit push)
# then compares the two catalogs (columns, constraints, indexes, enums). Any
# difference means a schema change landed without a matching migration (or a
# migration changed the database without schema.ts following), and the script
# exits non-zero with a diff.
#
# This does not rely on drizzle's meta/*_snapshot.json files, which stopped
# being kept up to date once migrations started being written by hand.
#
# Usage (from the repo root or server/):
#   PG_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres \
#     bash server/scripts/check-schema-drift.sh
#
# PG_ADMIN_URL must point at a role allowed to CREATE/DROP DATABASE. Two
# scratch databases are created next to it and dropped on exit.

set -euo pipefail

: "${PG_ADMIN_URL:?PG_ADMIN_URL must be set to an admin Postgres connection string}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
server_dir="$(cd "$here/.." && pwd)"

suffix="$$"
migrations_db="drift_migrations_${suffix}"
schema_db="drift_schema_${suffix}"

# Swap the database name at the end of PG_ADMIN_URL (keeps any ?query string).
db_url() {
  local name="$1" base query=""
  base="${PG_ADMIN_URL%%\?*}"
  if [[ "$PG_ADMIN_URL" == *\?* ]]; then query="?${PG_ADMIN_URL#*\?}"; fi
  echo "${base%/*}/${name}${query}"
}

migrations_url="$(db_url "$migrations_db")"
schema_url="$(db_url "$schema_db")"

workdir="$(mktemp -d)"
cleanup() {
  psql "$PG_ADMIN_URL" -qX -v ON_ERROR_STOP=0 \
    -c "DROP DATABASE IF EXISTS \"$migrations_db\"" \
    -c "DROP DATABASE IF EXISTS \"$schema_db\"" >/dev/null 2>&1 || true
  rm -rf "$workdir"
}
trap cleanup EXIT

psql "$PG_ADMIN_URL" -qX -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE \"$migrations_db\"" \
  -c "CREATE DATABASE \"$schema_db\""

cd "$server_dir"

echo "==> Applying migrations to an empty database"
DATABASE_URL="$migrations_url" pnpm exec drizzle-kit migrate

echo "==> Creating the database straight from src/db/schema.ts"
DATABASE_URL="$schema_url" pnpm exec drizzle-kit push --force

# One sorted line per object, so the two dumps can be diffed. Column order is
# deliberately ignored (ALTER TABLE ... ADD COLUMN always appends), as is
# anything outside the public schema (drizzle's own migration journal lives
# in the "drizzle" schema).
catalog_sql=$(cat <<'SQL'
SELECT line FROM (
  SELECT format('column     %s.%s %s%s%s',
           c.relname, a.attname,
           format_type(a.atttypid, a.atttypmod),
           CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
           COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '')) AS line
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND a.attnum > 0 AND NOT a.attisdropped

  UNION ALL
  SELECT format('constraint %s.%s %s', c.relname, con.conname, pg_get_constraintdef(con.oid))
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL
  SELECT format('index      %s.%s %s', tablename, indexname, indexdef)
  FROM pg_indexes
  WHERE schemaname = 'public'

  UNION ALL
  SELECT format('enum       %s (%s)', t.typname,
           string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder))
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  GROUP BY t.typname
) objects
ORDER BY line;
SQL
)

psql "$migrations_url" -qAtX -v ON_ERROR_STOP=1 -c "$catalog_sql" >"$workdir/migrations.txt"
psql "$schema_url" -qAtX -v ON_ERROR_STOP=1 -c "$catalog_sql" >"$workdir/schema.txt"

if diff -u --label "migrations (server/drizzle/*.sql)" --label "schema.ts (drizzle-kit push)" \
  "$workdir/migrations.txt" "$workdir/schema.txt" >"$workdir/drift.diff"; then
  echo "✔ No schema drift: migrations and src/db/schema.ts produce the same database ($(wc -l <"$workdir/schema.txt") objects)."
  exit 0
fi

cat "$workdir/drift.diff"
cat >&2 <<'MSG'

✖ Schema drift detected between server/src/db/schema.ts and server/drizzle/*.sql.

Lines starting with "-" exist only when applying the migrations; lines starting
with "+" exist only in schema.ts. Add a migration (and a _journal.json entry)
for the schema change, or update schema.ts to match the migrations.
MSG
exit 1
