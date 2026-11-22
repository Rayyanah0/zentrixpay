#!/usr/bin/env node
// Fails when a test file collected no tests (#188).
//
// A *.test.ts file that throws while importing (a missing export, a module
// that calls process.exit, a bad mock) shows up in Vitest's summary as a
// failed file with "(0 test)". Among real failures that is easy to miss, so
// this reads Vitest JSON reports and names every such file explicitly.
//
// Usage: node scripts/check-test-files-ran.mjs <vitest-report.json> [...]
//
// Produce a report with:
//   vitest run --reporter=default --reporter=json --outputFile.json=vitest-report.json
//
// Files whose tests are all skipped (e.g. *.pg.test.ts without
// TEST_DATABASE_URL) still collected tests, so they pass this check.

import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const reports = process.argv.slice(2);
if (reports.length === 0) {
  console.error("Usage: node scripts/check-test-files-ran.mjs <vitest-report.json> [...]");
  process.exit(2);
}

const problems = [];
let checked = 0;

for (const reportPath of reports) {
  const abs = resolve(reportPath);
  if (!existsSync(abs)) {
    problems.push({
      file: reportPath,
      reason:
        "Vitest JSON report not found — the test run did not finish or was not configured to write it",
    });
    continue;
  }

  let report;
  try {
    report = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    problems.push({ file: reportPath, reason: `report is not valid JSON: ${err.message}` });
    continue;
  }

  const files = Array.isArray(report.testResults) ? report.testResults : [];
  if (files.length === 0) {
    problems.push({ file: reportPath, reason: "report lists no test files" });
  }

  for (const file of files) {
    checked += 1;
    const tests = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    if (tests.length > 0) continue;

    const message = typeof file.message === "string" ? file.message.trim() : "";
    const firstLine = message.split("\n").find((line) => line.trim()) ?? "";
    problems.push({
      file: relative(process.cwd(), file.name ?? "<unknown>"),
      reason: firstLine
        ? `ran 0 tests — failed to load: ${firstLine}`
        : "ran 0 tests — the file collected no tests (did it fail to import?)",
    });
  }
}

if (problems.length > 0) {
  console.error(`\n✖ ${problems.length} test file(s) did not run any tests:\n`);
  for (const { file, reason } of problems) {
    console.error(`  - ${file}\n      ${reason}`);
  }
  console.error(
    "\nEvery *.test.ts(x) file must load and run at least one test. Fix the import error above,",
  );
  console.error("or delete the file if it no longer has tests.\n");
  process.exit(1);
}

console.log(`✔ All ${checked} test files ran at least one test.`);
