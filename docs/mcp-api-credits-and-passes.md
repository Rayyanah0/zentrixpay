# MCP: free quota, passes and prepaid credits (#246, #247, #248)

Today every `zentrixpay_call` settles one x402 payment. Providers can offer
cheaper ways to pay, but the MCP server ignores them:

| Option           | What the agent gets                                       | Issue that uses it                         |
| ---------------- | --------------------------------------------------------- | ------------------------------------------ |
| Free daily calls | N calls per UTC day at no cost                            | #246 (shows the quota)                     |
| Pass             | Unlimited calls until the pass expires                    | #246 (shows it), #248 (buys it)            |
| Prepaid credits  | One credit is spent per call, with no settlement per call | #246 (balance), #247 (spends), #248 (buys) |
| Price rules      | A different price per method or path                      | #246 (shows them)                          |

This doc sets out the server contract the MCP relies on, then the work for
each issue. Build them in order: **#246 → #247 → #248**. #246 adds the types
and the agent-status lookup that the other two reuse.

---

## 0. Server dependency (blocks all three)

> **Status:** not in the repo. `server/src/lib/apiCreditSignature.ts`, which
> the issues point to, does not exist on `main` or on
> `origin/feat/api-limits-cache-webhooks-health`. No route or schema mentions
> credits, passes, free quotas or price rules.

The MCP work needs the endpoints below. The shapes are a **proposal**. If the
server ends up with different ones, update this doc and the MCP types together.

### `GET /apis/:id`: pricing fields (added to the existing response)

```jsonc
{
  "id": "api1",
  "name": "Weather",
  "price": "0.01", // existing: default price per call
  "allowedMethods": ["GET"],
  "proxyUrl": "https://gw/api/api1",
  "priceRules": [
    // new; [] when none
    { "method": "POST", "pathPrefix": "/forecast", "price": "0.05" },
  ],
  "freeCallsPerDay": 100, // new; 0 when none
  "pass": { "price": "2.00", "durationSeconds": 86400 }, // new; null when not offered
  "creditBundles": [
    // new; [] when not offered
    { "id": "b100", "credits": 100, "price": "0.80" },
  ],
}
```

### `GET /apis/:id/agent-status`: what this agent already holds

Signed with the agent wallet, using the same signature as a credit spend (see
below), so one wallet cannot read another wallet's balance.

```jsonc
{
  "payer": "GABC…",
  "creditBalance": 42,
  "activePass": { "expiresAt": "2026-11-21T09:00:00Z" }, // or null
  "freeCallsRemainingToday": 17,
}
```

### Signed credit spend (on the proxy URL)

The agent calls the normal proxy URL with signature headers instead of an
x402 payment:

| Header                     | Value                                              |
| -------------------------- | -------------------------------------------------- |
| `X-ZentrixPay-Payer`       | Agent's Stellar public key (`G…`)                  |
| `X-ZentrixPay-Timestamp`   | Unix seconds                                       |
| `X-ZentrixPay-Nonce`       | Random value, single use (stops replay)            |
| `X-ZentrixPay-Use-Credits` | `1`                                                |
| `X-ZentrixPay-Signature`   | Base64 ed25519 signature over the canonical string |

The canonical string is newline-joined: `METHOD`, `PATH+QUERY`, `TIMESTAMP`,
`NONCE`, `BODY_SHA256_HEX`. This copies the layout in
[request-signature.md](request-signature.md) but uses an ed25519 signature
from the wallet key instead of an HMAC keyed with the API key. **Whatever
`apiCreditSignature.ts` ends up defining is the source of truth. The MCP must
build exactly the same string.**

Server responses:

| Response                                       | Meaning                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `2xx`/`4xx` + `X-ZentrixPay-Credits-Remaining` | One credit spent (none spent when upstream status is ≥ 400, same rule as x402) |
| `402` + `{"error":"credits_exhausted"}`        | No credits left. Nothing was spent                                             |
| `401`                                          | Bad signature, stale timestamp or reused nonce                                 |

### Buying a pass or credit bundle

`POST /apis/:id/pass` and `POST /apis/:id/credits` with body `{ "bundleId": "b100" }`.
Both are paid with x402, just like a call. On success they return the new
`agent-status` and the settlement appears in the `PAYMENT-RESPONSE` header.

---

## #246: show free quota, passes and credits in `zentrixpay_api_info`

**Goal:** an agent can see a cheaper option before it pays per call.

### Changes: `mcp/src/apiTools.ts`

1. Extend the type returned by `getApi()` with `priceRules`, `freeCallsPerDay`,
   `pass` and `creditBundles`. Treat each one as optional. An older server
   that leaves them out must still work and should read as "not offered".
2. Add a `fetchAgentStatus(apiId)` helper that sends a signed `GET
/apis/:id/agent-status`. It needs a new dependency on `ApiToolDeps`:

   ```ts
   signCreditRequest(
     wallet: { publicKey: string; secretKey: string },
     req: { method: string; pathAndQuery: string; body?: string },
   ): Record<string, string>; // the X-ZentrixPay-* headers
   ```

   Wire it in `index.ts` next to `paidFetch` (around `mcp/src/index.ts:3809`).
   Keep the signing code in its own module (`mcp/src/creditSignature.ts`) so it
   can be tested in isolation against fixed vectors.

3. `zentrixpay_api_info` returns the API, plus `agent` (from agent-status)
   and a one-line `cheapestOption` hint:

   ```jsonc
   {
     "id": "api1", "name": "Weather", "price": "0.01", "...": "...",
     "priceRules": [...], "freeCallsPerDay": 100,
     "pass": { "price": "2.00", "durationSeconds": 86400 },
     "creditBundles": [...],
     "agent": {
       "creditBalance": 42,
       "activePass": null,
       "freeCallsRemainingToday": 17
     },
     "cheapestOption": "17 free calls left today"
   }
   ```

   Pick `cheapestOption` in this order: active pass → free calls left →
   credits → per-call price.

4. If no wallet is configured, or the agent-status request fails, set `agent`
   to `null` and add an `agentStatusError` string. The tool still returns the
   public pricing. It is read-only and must never throw because the status
   lookup failed.
5. Update the tool description to mention free calls, passes and credits.
   Keep `readOnlyHint: true`.

### Tests: `mcp/src/apiTools.test.ts`

- Full pricing plus agent status is rendered as shown above.
- An old server (no new fields) gives `[]`, `0` and `null` defaults with no throw.
- No wallet gives `agent: null` while public pricing is still returned.
- `cheapestOption` precedence, one case per branch.
- Signature vectors in `creditSignature.test.ts`: fixed key, timestamp and
  nonce produce a fixed signature.

### Docs

Regenerate [mcp-tool-reference.md](mcp-tool-reference.md) and update
`toolSchemaSnapshots` / `toolMetadata` snapshots.

---

## #247: spend prepaid credits from `zentrixpay_call`

**Goal:** when the agent holds credits for an API, `zentrixpay_call` spends a
credit instead of settling an x402 payment.

### Flow (replaces the payment part of `call()` in `apiTools.ts`)

```
validate args, getApi, method check            (unchanged)
if useCredits !== false:
    status = fetchAgentStatus(api.id)           (signed; a failure counts as "no credits")
    if status.creditBalance > 0:
        res = fetch(url, { …, headers: { …headers, ...signCreditRequest(...) } })
        if res is 402 credits_exhausted:  fall through to x402
        else: return result with paidWith: "credits"
assertWithinCeiling(price, maxAutoPayUsdc)      (moved: only before an x402 payment)
insufficientFundsMessage(...)                   (moved: same reason)
paidFetch(...)                                  (unchanged x402 path)
```

Decisions behind this flow:

- **Move the ceiling and balance checks onto the x402 branch.** A credit call
  spends no new USDC. Checking the ceiling first would block credit calls to
  expensive APIs unless the agent also passes `maxAutoPayUsdc`.
- **Use plain `fetch` for credit calls, not `paidFetch`.** If the server
  replied 402 for some other reason, `paidFetch` would quietly pay it. A
  credit call must never settle on its own.
- **Fall back to x402 on `credits_exhausted`.** This can happen when the
  balance hits zero between the status check and the call. The fallback goes
  through the ceiling and balance checks above. `confirmPaid` and the mainnet
  gate have already run in the dispatcher because `zentrixpay_call` is listed
  in both, so a fallback never skips a guard.
- **Do not call `recordPurchase` for credit calls.** Purchase history records
  USDC settlements, and the credits were already recorded when they were
  bought (#248).

### New argument

```ts
useCredits: {
  type: "boolean",
  default: true,
  description: "Spend prepaid credits for this API when the agent has them. Pass false to always pay per call via x402.",
}
```

`useCredits: false` skips the status lookup completely, so it costs no extra
request.

### Output

Add `paidWith` and, for credit calls, `creditsRemaining`:

```jsonc
{
  "status": 200,
  "charged": true,
  "paidWith": "credits",
  "creditsRemaining": 41,
  "amount": "1 credit",
  "txHash": null,
  "...": "...",
}
```

For x402 calls `paidWith` is `"x402"` and all other fields stay as they are
today. A failed call (status ≥ 400) shows `charged: false` with either method.

### Tests (mocked server, as in the existing `setup()` helper)

- Balance > 0: request carries `X-ZentrixPay-*` headers, `paidFetch` is
  **not** called, and the output shows `paidWith: "credits"` and
  `creditsRemaining`. _(This is the acceptance test.)_
- Balance 0: x402 path, unchanged behaviour.
- `useCredits: false`: no agent-status request, x402 path.
- `credits_exhausted` 402: falls back to `paidFetch` exactly once.
- Credit call to an API priced above the ceiling, without `maxAutoPayUsdc`,
  succeeds.
- Agent-status request fails: x402 path, no throw.
- Upstream 500 on a credit call: `charged: false`, nothing recorded.
- `useCredits` is accepted by the unknown-argument check. This is automatic
  once it is in the schema.

---

## #248: buy passes and credits

**Goal:** an agent with heavy usage buys once instead of settling every call.

### New tools: `mcp/src/apiTools.ts`

| Tool                     | Endpoint                 | Required args       |
| ------------------------ | ------------------------ | ------------------- |
| `zentrixpay_buy_pass`    | `POST /apis/:id/pass`    | `apiId`             |
| `zentrixpay_buy_credits` | `POST /apis/:id/credits` | `apiId`, `bundleId` |

Both also take `maxAutoPayUsdc`, `confirmPaid` and `confirmMainnet`, reusing
the existing `CONFIRM_PAID` / `CONFIRM_MAINNET` constants. Annotations:
`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`.

### Handler steps

1. `getApi()`. Refuse with a clear error if the API offers no pass, or if the
   `bundleId` is not one of its `creditBundles` (list the valid ids).
2. **Pass only:** if agent-status shows an active pass, refuse unless the
   caller passes `renew: true`. This stops an agent loop from buying the same
   pass over and over.
3. `assertWithinCeiling(price, maxAutoPayUsdc)` using the pass or bundle price.
4. `insufficientFundsMessage(wallet, price, …)`.
5. `paidFetch(wallet)` POST. On success, `recordPurchase` with
   `resourceId: api.id`, the price, the settlement tx hash and a title such as
   `"Weather: 1-day pass"` or `"Weather: 100 credits"`.
6. Return `{ bought, amount, txHash, agent }`, where `agent` is the new
   agent-status.

### Guard registration (outside `apiTools.ts`)

| File                           | Change                                  |
| ------------------------------ | --------------------------------------- |
| `mcp/src/paidOperations.ts`    | Add both tools to `USDC_SPENDING_TOOLS` |
| `mcp/src/mainnetGuardrails.ts` | Add both tools to `MAINNET_GATED_TOOLS` |

Together these give the same guards as `zentrixpay_call`: `confirmPaid` when
`ZENTRIXPAY_CONFIRM_PAID_OPERATIONS` is `usdc` or `all`, `confirmMainnet` (or
`ZENTRIXPAY_ALLOW_MAINNET=1`) on mainnet, and the auto-pay ceiling.

### Tests

- `apiTools.test.ts`: buys a pass and buys credits through `paidFetch`, and
  records the purchase. Rejects an unknown `bundleId`. Rejects an API with no
  pass. Refuses an active pass without `renew`. Ceiling rejection happens
  before any payment.
- `paidOperations.test.ts`: both tools are classified `usdc`.
- `mainnetGuardrails.test.ts` / `mainnetMutationPolicy.test.ts`: both tools
  are refused on mainnet without confirmation. _(This is the acceptance
  criterion "mainnet-gated".)_
- Snapshot and listing tests (`toolSchemaSnapshots`, `toolMetadata`,
  `listToolsContract`, `readOnlyMode`): update for the two new tools.
- Regenerate [mcp-tool-reference.md](mcp-tool-reference.md).

---

## Out of scope

- Using the signed payer identity so that pass holders and free-quota calls
  skip x402 inside `zentrixpay_call`. It uses the same headers and is a
  natural follow-up once the server accepts them for passes and quota.
- Provider-side tools for setting price rules, passes or bundles.
