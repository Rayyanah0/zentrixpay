# End-to-end tests with Playwright

Tracks issue #244.

## Why

`web/src/**/*.test.tsx` are Vitest + jsdom component tests with `../api/apis.js` mocked. Nothing checks that the built web app, the real server and the paywall work together.

## Scope

Five flows, each a separate spec, against a real server and the Vite dev server:

| Spec                      | Flow                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `browse.spec.ts`          | Catalog loads and shows seeded APIs                                                                |
| `search.spec.ts`          | Search / tag filter narrows the list; clearing it restores the list                                |
| `detail.spec.ts`          | Click an API: detail page shows price, method, endpoint; deep link `/apis/:id` works on reload     |
| `provider-signup.spec.ts` | `/provider`: register as publisher, key shown, reload keeps the session key                        |
| `register-api.spec.ts`    | Signed-in provider creates an API; it appears in "My APIs" and, after verification, in the catalog |

Paying through Freighter is **out of scope**. A browser extension wallet can't be driven reliably in CI. Cover the 402 response and the "connect wallet" prompt, not the signature.

## Test environment

```
Playwright ──> Vite dev server :5173 ──(/resources proxy)──> server :4021 ──> Postgres
                                                               │
                                                               ├──> mock upstream :4100   (the "paid API")
                                                               └──> stub facilitator :4200 (x402 verify/settle)
```

### Things the server needs that don't exist yet

1. **Paywall test mode.** There is no flag for this today. The least invasive option is to point `FACILITATOR_URL` at a small stub (`e2e/stubs/facilitator.ts`) that answers `/verify` and `/settle` with success. This needs no server code change. Only add a dedicated `X402_TEST_MODE` flag if the stub turns out to be insufficient, and make it refuse to start when `NODE_ENV=production`.
2. **Registry contract.** `REGISTRY_CONTRACT_ID` and `REGISTRY_SECRET_KEY` are required, and publishing writes on-chain. Options, in order of preference:
   - an injectable no-op registry when `NODE_ENV=test` (check `server/src/config.ts` for an existing seam first)
   - a dedicated testnet contract plus a funded key in CI secrets (slower and flaky; avoid)
3. **Private upstream.** Set `PROXY_ALLOW_PRIVATE_UPSTREAMS=true` so the server will proxy to `localhost:4100`.
4. **Ownership verification.** Have the mock upstream serve whatever token the verification step asks for (see `OwnershipInstructions` in the provider dashboard).

### Layout

```
web/
  playwright.config.ts
  e2e/
    global-setup.ts        # migrate + seed DB, start stubs
    stubs/
      upstream.ts          # tiny node:http server
      facilitator.ts
    fixtures.ts            # seeded API ids, provider helper
    *.spec.ts
```

`playwright.config.ts` should use `webServer` with two entries, so Playwright starts and waits for both processes:

```ts
webServer: [
  { command: "pnpm --filter @zentrixpay/server dev", url: "http://localhost:4021/health", reuseExistingServer: !process.env.CI, env: { ... } },
  { command: "pnpm --filter @zentrixpay/web dev", url: "http://localhost:5173", reuseExistingServer: !process.env.CI },
],
use: { baseURL: "http://localhost:5173", trace: "on-first-retry" },
projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
retries: process.env.CI ? 2 : 0,
```

Confirm the server's health route path before you rely on `/health`.

Use role and label selectors (`getByRole("button", { name: ... })`), which also covers accessibility. Use `data-testid` only where there is no accessible name.

### Scripts

`web/package.json`:

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui"
```

Add `@playwright/test` as a dev dependency. Add `web/test-results/` and `web/playwright-report/` to `.gitignore`. Make sure `vitest.config.ts` excludes `e2e/**` so `pnpm test` doesn't pick up the specs.

## CI

Add a separate job to `.github/workflows/pr.yml` so a flaky E2E doesn't hide unit-test results:

```yaml
web-e2e:
  name: Web end-to-end
  runs-on: ubuntu-latest
  needs: node-ci
  services:
    postgres:
      {
        image: postgres:16-alpine,
        env: { POSTGRES_PASSWORD: postgres },
        ports: ["5432:5432"],
        options: '--health-cmd "pg_isready -U postgres" --health-interval 5s --health-retries 10',
      }
  steps:
    - uses: actions/checkout@v7
    - uses: pnpm/action-setup@v6
    - uses: actions/setup-node@v7
      with: { node-version: "20", cache: "pnpm" }
    - run: pnpm install --frozen-lockfile
    - run: pnpm run build:registry-client
    - run: pnpm --filter @zentrixpay/web exec playwright install --with-deps chromium
    - run: pnpm --filter @zentrixpay/web e2e
      env:
        DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
        NODE_ENV: test
        FACILITATOR_URL: http://localhost:4200
        PROXY_ALLOW_PRIVATE_UPSTREAMS: "true"
    - if: failure()
      uses: actions/upload-artifact@v4
      with: { name: playwright-report, path: web/playwright-report }
```

## Acceptance

- `pnpm --filter @zentrixpay/web e2e` passes locally with one command, given a local Postgres (see [local-setup.md](local-setup.md)).
- The `web-e2e` job runs on every PR and uploads the trace/report on failure.
- No real network calls: no testnet, no public facilitator, no external upstream.
