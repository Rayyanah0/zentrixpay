# Splitting ProviderDashboard into smaller components

Tracks issue #241.

## Why

`web/src/components/ProviderDashboard.tsx` is 842 lines. It holds provider sign-in, the new-API form, ownership verification, the API cards, price editing and stats in one file. Most provider-side PRs touch it, so it is a frequent source of merge conflicts and hard to review.

## Goal

- No file over about 300 lines.
- No behaviour change. Rendered markup, text, class names and API calls stay the same.
- `ProviderDashboard.test.tsx` passes **without edits**. If a test needs changing, the refactor changed behaviour.

## What is in the file today

| Lines   | Symbol                                                            | Notes                                                    |
| ------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| 1–32    | imports, `inputClass`, `primaryButton`, `secondaryButton`, `card` | Tailwind class strings shared by everything below        |
| 33–60   | `Field`                                                           | Labelled form field wrapper                              |
| 61–92   | `RememberKeyOption`                                               | "Remember key on this device" checkbox                   |
| 93–225  | `ProviderAccess`                                                  | Register / paste API key, uses `providerKeyStorage`      |
| 226–386 | `NewApiForm`                                                      | Create-API form (`createApi`)                            |
| 387–417 | `CopyButton`, `downloadTxt`                                       | Small helpers                                            |
| 418–549 | `OwnershipInstructions`                                           | Ownership verification steps (`verifyApiOwnership`)      |
| 550–603 | `StatsPanel`                                                      | Renders `ApiStats`                                       |
| 604–751 | `ApiCard`                                                         | One owned API: price editing, pause/resume, stats toggle |
| 752–842 | `ProviderDashboard` (exported)                                    | Top-level page: key state, `fetchMyApis`, list           |

There is no `ApiEditForm` component yet. The price input and save button live inside `ApiCard` (its `price` state, `updateApi` call). Extract them into `ApiEditForm` as part of this work.

## Target layout

```
web/src/components/
  ProviderDashboard.tsx          # page shell only (~100 lines)
  provider/
    styles.ts                    # inputClass, primaryButton, secondaryButton, card
    Field.tsx                    # Field, RememberKeyOption
    ProviderAccess.tsx
    NewApiForm.tsx
    OwnershipInstructions.tsx    # + CopyButton, downloadTxt
    ApiCard.tsx
    ApiEditForm.tsx
    StatsPanel.tsx
```

`ProviderDashboard` stays at its current path and keeps its named export. `App.tsx` and the test import it from `./components/ProviderDashboard.js` and must not change.

## Rules for the move

1. **Move, don't rewrite.** Cut each function into its new file verbatim, then add imports. Do not rename props, reorder JSX or "tidy up" in the same PR. That keeps the diff reviewable with `git diff --color-moved`.
2. **Keep imports going through `../api/apis.js`.** The test mocks that module with `vi.mock("../api/apis.js", ...)`. From `components/provider/` the import is `../../api/apis.js`. Vitest resolves both to the same module, so the mock still applies. Don't import from anywhere else, such as a re-export barrel.
3. **Use `.js` import suffixes**, as the rest of `web/src` does.
4. **`ApiEditForm` props.** Pass in what `ApiCard` already has: `api`, `apiKey`, `busy` and a `run(label, fn)` callback (the existing helper that sets `busy` and `error`). Keep `busy`/`error` state in `ApiCard` so the error banner location doesn't move.
5. **No new behaviour, no new strings.** i18n of these strings is handled separately (see [web-i18n-coverage.md](web-i18n-coverage.md)).

## Suggested commit order

One commit per extraction, so a failing test points at one move:

1. `styles.ts` + `Field.tsx`
2. `StatsPanel.tsx`
3. `OwnershipInstructions.tsx`
4. `NewApiForm.tsx`
5. `ApiEditForm.tsx` (out of `ApiCard`), then `ApiCard.tsx`
6. `ProviderAccess.tsx`

## Verifying

```bash
pnpm --filter @zentrixpay/web typecheck
pnpm --filter @zentrixpay/web test
wc -l web/src/components/ProviderDashboard.tsx web/src/components/provider/*.tsx
git diff --stat main -- web/src/components/ProviderDashboard.test.tsx   # must be empty
```

Also open `/provider` in `pnpm --filter @zentrixpay/web dev` and click through sign-in, create, edit price, show stats. Unit tests only cover key storage, so a manual pass is still needed.
