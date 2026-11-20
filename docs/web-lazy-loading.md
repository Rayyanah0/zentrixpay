# Lazy-loading charts and the wallet / x402 code

Tracks issue #242. See also [bundle-analysis.md](bundle-analysis.md).

## Why

Most visitors browse the catalog and never pay for a call. They still download the Stellar SDK, Freighter API and x402 client, because these are imported statically at startup.

## Where the weight actually comes from

The issue names `StatsCharts.tsx`, but **`StatsCharts` is not imported anywhere today**, so Rollup already tree-shakes it out. Lazy-loading it is still the right pattern when it gets wired into the provider dashboard. The measurable win is the payment path:

```
App.tsx ─────────────┐
ApiDetailPage.tsx ───┴─> TryItModal.tsx ─> lib/x402Call.ts ─┬─> @x402/fetch
                                                            ├─> @x402/stellar
                                                            └─> lib/x402Buy.ts ─> @x402/stellar/exact/client
                                                                              └─> @zentrixpay/registry-client
```

`TryItModal` is imported at module top level by both `App.tsx` and `ApiDetailPage.tsx`, even though it only renders after the user clicks "Try it". `x402Buy.ts` already uses dynamic `import("@stellar/freighter-api")`. The rest of the chain needs the same treatment.

Also check `hooks/useWalletConnection.ts`, `hooks/useUsdcBalance.ts` and `hooks/useNetworkCheck.ts`. These run on every page through `WalletButton`. If any of them statically import `@stellar/stellar-sdk`, move that import inside the function that needs it.

## Changes

### 1. Lazy `TryItModal`

```tsx
// App.tsx and ApiDetailPage.tsx
const TryItModal = React.lazy(() =>
  import("./components/TryItModal.js").then((m) => ({ default: m.TryItModal })),
);

{tryItApi && (
  <Suspense fallback={null}>
    <TryItModal ... />
  </Suspense>
)}
```

Render it only when it's open, so the chunk is fetched on first click rather than on page load.

### 2. Dynamic import inside `x402Call.ts`

As a second line of defence, load the x402 modules inside `callPaidApi` instead of at the top of the file:

```ts
export async function callPaidApi(...) {
  const [{ x402Client, wrapFetchWithPayment, decodePaymentResponseHeader }, { ExactStellarScheme }] =
    await Promise.all([import("@x402/fetch"), import("@x402/stellar")]);
  ...
}
```

Keep `import type` lines static. They are erased at build time.

### 3. `StatsCharts`

When it is mounted (for example from `ApiCard` in the provider dashboard), mount it with `React.lazy` + `Suspense` in the same way, with a small skeleton as the fallback.

### 4. Tests

`TryItModal.test.tsx` and `Accessibility.test.tsx` import `TryItModal` directly and mock `../lib/x402Call.js`. That still works. Tests that render `App` and open the modal must `await` the lazy chunk (`findBy*` instead of `getBy*`).

## Measuring before / after

Run on `main` first, then on your branch:

```bash
pnpm --filter @zentrixpay/web build 2>&1 | tee build.log
# Vite prints each chunk with min + gzip size
pnpm --filter @zentrixpay/web bundle:stats   # treemap in web/stats.html
```

Put this table in the PR description:

|        | Initial JS (min) | Initial JS (gzip) | Lazy chunks          |
| ------ | ---------------- | ----------------- | -------------------- |
| Before |                  |                   | –                    |
| After  |                  |                   | TryItModal + x402: … |

"Initial JS" means the entry chunk plus everything `index.html` loads through `<script>` / `modulepreload`. Check `dist/index.html` to be sure.

Then update the baseline table in [bundle-analysis.md](bundle-analysis.md).

## Acceptance

- The initial bundle (gzip) is measurably smaller, with numbers in the PR.
- Opening "Try it" still works with Freighter on testnet. The chunk loads on first click (Network tab).
- The PWA still works offline for the catalog. Workbox precaches `**/*.js`, so lazy chunks are precached too. That's fine, but confirm `maximumFileSizeToCacheInBytes` (5 MB) isn't exceeded.
