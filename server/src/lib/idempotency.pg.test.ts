import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

const { databaseUrl } = vi.hoisted(() => ({ databaseUrl: { value: "" } }));

vi.mock("../config.js", () => ({
  config: {
    get DATABASE_URL() {
      return databaseUrl.value;
    },
    IDEMPOTENCY_TTL_MS: 60_000,
    PROXY_IDEMPOTENCY_TTL_MS: 60_000,
    PROXY_IDEMPOTENCY_MAX_ENTRIES: 100,
  },
}));

import { createPostgresProxyIdempotencyStore } from "./idempotency.js";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describePg = testDatabaseUrl ? describe : describe.skip;

describePg("paid proxy idempotency store (real Postgres)", () => {
  const schemaName = `zp_idempotency_${randomBytes(4).toString("hex")}`;
  let adminSql: postgres.Sql | undefined;

  beforeAll(async () => {
    adminSql = postgres(testDatabaseUrl!, { max: 1, onnotice: () => {} });
    await adminSql.unsafe(`CREATE SCHEMA ${schemaName}`);
    await adminSql.unsafe(`
      CREATE TABLE ${schemaName}.proxy_idempotency (
        api_id integer NOT NULL,
        payer text NOT NULL,
        idempotency_key text NOT NULL,
        fingerprint text NOT NULL,
        state text NOT NULL,
        payment_hash text,
        response jsonb,
        tx_hash text,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT proxy_idempotency_state_check CHECK (state IN ('in_progress', 'completed'))
      );
      CREATE UNIQUE INDEX proxy_idempotency_api_payer_key_idx
        ON ${schemaName}.proxy_idempotency (api_id, payer, idempotency_key);
      CREATE INDEX proxy_idempotency_expires_at_idx
        ON ${schemaName}.proxy_idempotency (expires_at);
    `);

    const scopedUrl = new URL(testDatabaseUrl!);
    scopedUrl.searchParams.set("options", `-c search_path=${schemaName}`);
    databaseUrl.value = scopedUrl.toString();
  });

  afterAll(async () => {
    if (databaseUrl.value) {
      const { pgClient } = await import("../db/client.js");
      await pgClient.end();
    }
    if (adminSql) {
      await adminSql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
      await adminSql.end();
    }
  });

  it("uses the database unique key to prevent double claims across store instances", async () => {
    const firstInstance = createPostgresProxyIdempotencyStore();
    const secondInstance = createPostgresProxyIdempotencyStore();
    const key = { apiId: 7, payer: "GTESTPAYER", key: "shared-retry" };
    const fingerprint = "request-fingerprint";

    const claims = await Promise.all([
      firstInstance.claim(key, fingerprint),
      secondInstance.claim(key, fingerprint),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);

    const winner = claims[0] ? firstInstance : secondInstance;
    const reader = claims[0] ? secondInstance : firstInstance;
    await winner.complete(key, {
      inProgress: false,
      fingerprint,
      paymentHash: "payment-hash",
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"ok":true}'),
      },
      txHash: null,
    });

    expect(await reader.get(key)).toMatchObject({
      inProgress: false,
      fingerprint,
      paymentHash: "payment-hash",
      response: { status: 200, body: Buffer.from('{"ok":true}') },
    });
  });
});
