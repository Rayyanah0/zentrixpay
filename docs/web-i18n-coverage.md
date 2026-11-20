# Spanish translation coverage and the missing-keys check

Tracks issue #243.

## Current state

- Translations live in `web/src/i18n/locales/en.json` and `es.json`, loaded by `web/src/i18n/config.ts`, with `fallbackLng: "en"`.
- **Every key in `en.json` already exists in `es.json`** (checked 2026-11-20). The real gap is strings that never go through `t()`, so they show in English even with Spanish selected.
- Components that render user-facing text without `useTranslation`:

| Component               | `t()` calls today                              |
| ----------------------- | ---------------------------------------------- |
| `TryItModal.tsx`        | 0                                              |
| `WalletButton.tsx`      | 0                                              |
| `Toast.tsx`             | 0                                              |
| `ErrorBanner.tsx`       | 0                                              |
| `ErrorBoundary.tsx`     | 0                                              |
| `ApiDetailModal.tsx`    | 0                                              |
| `StatsCharts.tsx`       | 1                                              |
| `ProviderDashboard.tsx` | 2 (almost the whole provider UI is hard-coded) |

If #241 (split ProviderDashboard) lands first, translate the new `components/provider/*` files instead. Coordinate so the two PRs don't conflict.

## The check script

Add `web/scripts/check-i18n.mjs` and a `check:i18n` script in `web/package.json`. It fails (exit 1) on either of these:

### 1. Key parity

Flatten both JSON files to dotted keys (`provider.newApi.title`) and report:

- keys in `en` missing from `es` (error)
- keys in `es` not in `en` (error; these are stale)
- values in `es` identical to `en` (warning only, since brand names like "ZentrixPay" or "USDC" legitimately match)

### 2. Untranslated JSX literals

Scan `web/src/components/**/*.tsx`, skipping `*.test.tsx`, and flag:

- JSX text nodes with at least one letter, e.g. `<button>Save</button>`
- string literals in user-visible attributes: `placeholder`, `title`, `alt`, `aria-label`, `label`

Use the TypeScript compiler API (`typescript` is already a dev dependency) rather than regex, so `{t("x")}` and `className="..."` aren't misreported.

Allowlist:

- whitespace and punctuation-only text (`·`, `—`, `:`, `/`)
- a short list of non-translatable tokens in the script (`ZentrixPay`, `USDC`, `XLM`, `Stellar`, `Freighter`, `x402`, `GET`/`POST`/…)
- an opt-out comment for genuine exceptions: `{/* i18n-ignore */}` on the line above

Output should be `file:line  "literal"`, one per line, so it's clickable in CI logs and editors.

## Filling the gaps

1. Run the script to get the list.
2. For each component, add `const { t } = useTranslation();` and replace literals with keys namespaced by component, for example `tryIt.send`, `wallet.connect`, `provider.newApi.price`.
3. Add each key to `en.json` and `es.json` in the same commit. Have a fluent speaker review the Spanish, or at least flag machine translations in the PR description for review.
4. Use interpolation, not concatenation: `t("tryIt.paid", { amount })` with `"Pagado {{amount}} USDC"`.
5. Tests that assert English text keep working, because tests render with `lng: "en"`.

## CI

Add one step to the `node-ci` job in `.github/workflows/pr.yml`, after the web tests:

```yaml
- run: pnpm --filter @zentrixpay/web check:i18n
```

## Acceptance

- `pnpm --filter @zentrixpay/web check:i18n` passes locally and in CI.
- Switching to Español with `LanguageSwitcher` shows no English on the catalog, detail page, Try-it modal or provider dashboard, apart from allowlisted tokens.
