import { describe, expect, it, vi } from "vitest";

// Issue #294: every route must be declared in routeAuthInventory.ts with the
// guard it sits behind. createApp() is built for real so a router added to
// app.ts is picked up too; only configuration is stubbed so the modules load
// without a database or network.
vi.hoisted(() => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    NETWORK: "stellar:testnet",
    USDC_CONTRACT_ID: "CUSDCTESTCONTRACT",
    SOROBAN_RPC_URL: "https://soroban-testnet.example",
    DATABASE_URL: "postgres://inventory:inventory@127.0.0.1:5432/inventory",
    REGISTRY_CONTRACT_ID: "CREGISTRYTESTCONTRACT",
    REGISTRY_SECRET_KEY: "SINVENTORYTESTSECRET",
  });
});

import { createApp } from "../app.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { walletSignatureAuth } from "../middleware/walletSignatureAuth.js";
import { loadProxiedApi } from "../middleware/apiPaywall.js";
import { ROUTE_AUTH_INVENTORY, type RouteGuard } from "./routeAuthInventory.js";

type Handler = (...args: unknown[]) => unknown;

interface Layer {
  handle?: Handler & { stack?: Layer[] };
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
    stack: Layer[];
  };
}

interface DiscoveredRoute {
  key: string;
  guard: RouteGuard;
}

// Ordered: the first match wins, so a route carrying several guards reports
// the strongest caller-identifying one.
const GUARD_HANDLERS: Array<[RouteGuard, Handler]> = [
  ["apiKey", apiKeyAuth as Handler],
  ["walletSignature", walletSignatureAuth as Handler],
  ["x402", loadProxiedApi as Handler],
];

function guardOf(stack: Layer[]): RouteGuard {
  const handlers = new Set(stack.map((layer) => layer.handle));
  for (const [guard, handler] of GUARD_HANDLERS) {
    if (handlers.has(handler)) return guard;
  }
  return "public";
}

function collectRoutes(stack: Layer[], out: DiscoveredRoute[]): DiscoveredRoute[] {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      const methods = layer.route.methods._all
        ? ["ALL"]
        : Object.keys(layer.route.methods)
            .filter((m) => layer.route!.methods[m])
            .map((m) => m.toUpperCase());
      const guard = guardOf(layer.route.stack);
      for (const path of paths) {
        for (const method of methods) out.push({ key: `${method} ${path}`, guard });
      }
    } else if (Array.isArray(layer.handle?.stack)) {
      // A mounted Router (app.use(router)). Routers here are mounted at "/",
      // so their route paths are already absolute.
      collectRoutes(layer.handle.stack, out);
    }
  }
  return out;
}

function discoverRoutes(): DiscoveredRoute[] {
  const app = createApp() as unknown as { router?: { stack: Layer[] }; _router?: { stack: Layer[] } };
  const router = app.router ?? app._router;
  if (!router) throw new Error("Could not find the Express router stack on the app");
  return collectRoutes(router.stack, []);
}

describe("route authentication inventory (#294)", () => {
  const routes = discoverRoutes();

  it("discovers the app's routes", () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it("registers each method+path only once", () => {
    const seen = new Set<string>();
    const duplicates = routes.map((r) => r.key).filter((key) => seen.has(key) || !seen.add(key));
    expect(duplicates).toEqual([]);
  });

  it("declares every registered route in routeAuthInventory.ts", () => {
    const undeclared = routes.map((r) => r.key).filter((key) => !(key in ROUTE_AUTH_INVENTORY));
    expect(
      undeclared,
      "Add these routes to server/src/routes/routeAuthInventory.ts with the guard they need",
    ).toEqual([]);
  });

  it("lists no routes that no longer exist", () => {
    const registered = new Set(routes.map((r) => r.key));
    const stale = Object.keys(ROUTE_AUTH_INVENTORY).filter((key) => !registered.has(key));
    expect(stale, "Remove these entries from routeAuthInventory.ts").toEqual([]);
  });

  it("guards every route the way the inventory declares", () => {
    const mismatched = routes
      .filter((r) => r.key in ROUTE_AUTH_INVENTORY && ROUTE_AUTH_INVENTORY[r.key] !== r.guard)
      .map((r) => `${r.key}: declared ${ROUTE_AUTH_INVENTORY[r.key]}, found ${r.guard}`);
    expect(mismatched).toEqual([]);
  });
});
