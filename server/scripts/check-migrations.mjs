#!/usr/bin/env node
// Validates Drizzle migrations under server/drizzle/:
//  - no two migration files may share a numeric prefix
//  - every migration .sql file must be listed in meta/_journal.json

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "drizzle");
const journalPath = join(migrationsDir, "meta", "_journal.json");

const errors = [];

if (!existsSync(journalPath)) {
  console.error(`Missing migration journal: ${journalPath}`);
  process.exit(1);
}

const journal = JSON.parse(readFileSync(journalPath, "utf8"));
const journaled = new Set((journal.entries ?? []).map((e) => `${e.tag}.sql`));

const sqlFiles = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

const byPrefix = new Map();
for (const file of sqlFiles) {
  const match = /^(\d+)_/.exec(file);
  if (!match) {
    errors.push(`Migration file has no numeric prefix: ${file}`);
    continue;
  }
  const prefix = match[1];
  if (!byPrefix.has(prefix)) byPrefix.set(prefix, []);
  byPrefix.get(prefix).push(file);
}

for (const [prefix, files] of byPrefix) {
  if (files.length > 1) {
    errors.push(
      `Duplicate migration prefix ${prefix}: ${files.sort().join(", ")}`,
    );
  }
}

for (const file of sqlFiles.sort()) {
  if (!journaled.has(file)) {
    errors.push(`Migration not listed in _journal.json: ${file}`);
  }
}

if (errors.length > 0) {
  console.error("Migration check failed:");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log(`Migration check passed (${sqlFiles.length} migrations).`);
