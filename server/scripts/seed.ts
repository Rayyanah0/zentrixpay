// Seed a demo publisher and a few listed APIs for local development (#258).
//
// The APIs point at the local mock upstream (`server/scripts/mock-upstream.ts`),
// so with both running every listed API answers through the paid proxy:
//
//   pnpm --filter @zentrixpay/server exec tsx scripts/mock-upstream.ts
//   pnpm seed
//
// Re-running is safe: the publisher is matched by email and each API by
// publisher + name, and both are updated in place.
import { and, eq } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { apis, publishers } from "../src/db/schema.js";
import { hashApiKey } from "../src/utils/crypto.js";

const MOCK_UPSTREAM_BASE_URL =
  process.env.MOCK_UPSTREAM_BASE_URL ??
  `http://${process.env.MOCK_UPSTREAM_HOST ?? "127.0.0.1"}:${process.env.MOCK_UPSTREAM_PORT ?? 8787}`;

// mock-upstream.ts serves this token at /.well-known/zentrixpay.txt.
const OWNERSHIP_TOKEN = process.env.ZENTRIXPAY_TOKEN ?? "local-dev-token";

// Testnet address used only as a local payout target; replace it with your own
// wallet (`pnpm generate-wallet`) to receive test payments.
const DEMO_WALLET =
  process.env.SEED_WALLET_ADDRESS ?? "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";

// A fixed dev key so local API-key requests are reproducible.
// Never use this outside local development.
const DEMO_API_KEY = process.env.SEED_PUBLISHER_API_KEY ?? "zp_dev_seed_key";

const DEMO_PUBLISHER = {
  name: "Demo Provider",
  email: "demo@example.com",
};

interface SeedApi {
  name: string;
  description: string;
  path: string;
  price: string; // USDC per call
  allowedMethods: string[];
}

// Only routes mock-upstream.ts actually serves.
const DEMO_APIS: SeedApi[] = [
  {
    name: "Echo",
    description: "Echoes back the request. Useful for smoke tests.",
    path: "/echo",
    price: "0.01",
    allowedMethods: ["GET", "POST"],
  },
  {
    name: "Slow",
    description: "Answers after a delay, for timeout testing.",
    path: "/slow",
    price: "0.01",
    allowedMethods: ["GET"],
  },
  {
    name: "Large Payload",
    description: "Returns a large body, for response-size limits.",
    path: "/large",
    price: "0.02",
    allowedMethods: ["GET"],
  },
  {
    name: "Error",
    description: "Always fails upstream, for refund and error handling.",
    path: "/error",
    price: "0.01",
    allowedMethods: ["GET"],
  },
];

async function upsertPublisher(): Promise<string> {
  const values = {
    name: DEMO_PUBLISHER.name,
    email: DEMO_PUBLISHER.email,
    walletAddress: DEMO_WALLET,
    apiKeyHash: hashApiKey(DEMO_API_KEY),
  };
  const [row] = await db
    .insert(publishers)
    .values(values)
    .onConflictDoUpdate({
      target: publishers.email,
      set: {
        name: values.name,
        walletAddress: values.walletAddress,
        apiKeyHash: values.apiKeyHash,
      },
    })
    .returning({ id: publishers.id });
  return row.id;
}

async function upsertApi(publisherId: string, api: SeedApi): Promise<void> {
  const values = {
    publisherId,
    name: api.name,
    description: api.description,
    upstreamUrl: `${MOCK_UPSTREAM_BASE_URL}${api.path}`,
    price: api.price,
    walletAddress: DEMO_WALLET,
    allowedMethods: api.allowedMethods,
    ownershipToken: OWNERSHIP_TOKEN,
    ownershipVerifiedAt: new Date(),
    listed: true,
  };
  const [existing] = await db
    .select({ id: apis.id })
    .from(apis)
    .where(and(eq(apis.publisherId, publisherId), eq(apis.name, api.name)))
    .limit(1);
  if (existing) {
    await db.update(apis).set(values).where(eq(apis.id, existing.id));
  } else {
    await db.insert(apis).values(values);
  }
}

async function main(): Promise<void> {
  const publisherId = await upsertPublisher();
  for (const api of DEMO_APIS) {
    await upsertApi(publisherId, api);
  }
  console.log(
    `Seeded "${DEMO_PUBLISHER.name}" (API key: ${DEMO_API_KEY}) with ${DEMO_APIS.length} listed APIs ` +
      `pointing at ${MOCK_UPSTREAM_BASE_URL}.`,
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
