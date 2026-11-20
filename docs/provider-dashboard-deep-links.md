# Provider dashboard deep links (#245)

Guidance such as "fix your API's ownership" should link straight to that API's
card, not to the top of the dashboard. This doc defines a `?api=<id>` link and
how the dashboard handles it.

## Link format

```
https://<web-host>/?api=<apiId>
```

`<apiId>` is the id from `zentrixpay_my_apis` or `GET /publishers/me/apis`,
URL-encoded. Build links with one helper so there is a single place to change
the format later:

```ts
// web/src/lib/links.ts
export function providerApiLink(apiId: string, origin = window.location.origin): string {
  return `${origin}/?api=${encodeURIComponent(apiId)}`;
}
```

## Current state (why this needs more than one file)

- **The tab lives in state, not the URL.** `App.tsx` starts on
  `useState<Tab>("browse")`, so a link would open the catalog, not the
  dashboard.
- **Cards cannot be collapsed.** On `main`, `ApiCard` always shows its full
  body. The only part that opens and closes is the **Stats** panel.
- **The dashboard needs an API key.** Without a stored key it shows
  `ProviderAccess` instead of the list.
- **APIs load asynchronously.** The card does not exist until
  `fetchMyApis` resolves.

## Behaviour

| Situation                                     | Result                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `?api=` present                               | App opens on the **Sell your API** tab                                   |
| Not signed in                                 | Sign-in form shown. The param stays in the URL and is used after sign-in |
| APIs loading                                  | Nothing yet. Focus happens once the list renders                         |
| Matching card                                 | Scroll it into view, move focus to it, highlight it briefly              |
| No match (wrong id or another provider's API) | Inline notice above the list: "No API with id `<id>` in your account"    |
| Malformed id (fails `^[A-Za-z0-9_-]{1,64}$`)  | Ignored, same as no param                                                |

**What "expand" means here:** cards on `main` have no collapsed state, so
there is nothing to expand. Focusing the card already shows everything,
including the ownership-verification box. If collapsible cards arrive later,
the targeted card should start expanded. Pass that through the same
`focusApiId` prop.

Handle the link **once per page load**. Switching tabs and coming back must
not scroll again. Leave the param in the URL so the link can still be copied
and shared.

## Implementation

### `web/src/App.tsx`

```ts
const initialApiId = useMemo(() => {
  const id = new URLSearchParams(window.location.search).get("api");
  return id && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}, []);
const [tab, setTab] = useState<Tab>(initialApiId ? "provide" : "browse");
…
<ProviderDashboard wallet={wallet} onCopy={copy} focusApiId={initialApiId} />
```

### `web/src/components/ProviderDashboard.tsx`

1. Accept `focusApiId?: string | null`.
2. Keep a `handled` ref so the focus effect runs only once.
3. Once `data` has loaded, find the card. If it exists:
   - `el.scrollIntoView({ block: "start", behavior: reducedMotion ? "auto" : "smooth" })`.
     Read `reducedMotion` from `matchMedia("(prefers-reduced-motion: reduce)")`.
   - `el.focus({ preventScroll: true })`. The card's `<li>` needs
     `tabIndex={-1}` and an `aria-labelledby` that points at its heading, so
     screen readers announce the API name.
   - Add a highlight ring, for example `ring-2 ring-indigo-500`, and remove it
     after about 2 s.
     If it does not exist, show the "No API with id" notice.
4. Give `ApiCard` a ref through a `Map<string, HTMLLIElement>` keyed by
   `api.id`, or use `document.getElementById(\`api-${id}\`)`with an`id`on
each`<li>`. The `id`approach is simpler and also makes`#api-<id>`
   anchors work for free.

Because `ProviderAccess` swaps out the whole list, the effect runs after
sign-in with no extra code. The prop is still set and `handled` is still false.

## Producing links

Use `providerApiLink(id)` wherever the web app tells a provider to act on one
API, for example toasts and the catalog. Server or MCP messages that link to
the dashboard need the web origin from config. Do not hard-code it.

## Tests: `web/src/components/ProviderDashboard.test.tsx` (new)

Base them on `CreatorDashboard.test.tsx`. Mock `fetchMyApis` to return two
APIs, and stub `Element.prototype.scrollIntoView`, which jsdom does not
implement.

- `focusApiId` of the second API: that card's `<li>` is
  `document.activeElement` and `scrollIntoView` was called on it.
  _(This is the acceptance test.)_
- Unknown id: notice shown, nothing focused or scrolled.
- No stored key: sign-in form shown. After sign-in the card is focused.
- Re-render with the same prop: `scrollIntoView` called only once.
- `App.test.tsx`: `?api=x` in `window.location.search` opens the provider tab.

## Coordination

`origin/feat/api-limits-cache-webhooks-health` rewrites
`ProviderDashboard.tsx` (about 860 lines changed). If that branch merges
first, apply the same steps to its card component. If it adds collapsible
cards, also start the focused card expanded.
