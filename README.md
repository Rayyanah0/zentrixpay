# ZentrixPay

ZentrixPay is a pay-per-call gateway for HTTP APIs, built on Stellar. A provider puts an API behind ZentrixPay and sets a price per call in USDC. Anyone who calls it — a person in a browser, a script, or an AI agent — pays for each call with the [x402 protocol](docs/GLOSSARY.md#x402), and the USDC goes straight to the provider's Stellar wallet.

No accounts, no API-key signups, no subscriptions. One HTTP request, one payment.

## How a call works

```
caller ──GET /api/<id>/weather?city=lagos──▶ ZentrixPay
       ◀──────── 402 Payment Required ─────── (price, payee, network)
caller ──same request + signed USDC payment─▶ ZentrixPay ──forward──▶ provider's API
       ◀──────────── API response ─────────── settle payment ◀──────── 200 OK
```

1. The caller requests `https://<zentrixpay>/api/<id>/<path>`.
2. ZentrixPay answers **402** with the price, the provider's wallet and the Stellar network.
3. The caller signs a USDC payment and retries. Any x402 client does this automatically.
4. ZentrixPay forwards the request to the provider's real API and returns the response.
5. The payment settles on Stellar **only if the API answered with a status below 400**. Errors, timeouts and oversized responses are never charged.

Passes, free daily calls, prepaid credits, payer allow/deny lists and per-endpoint price rules can change whether a call is charged and how much. The full decision order, with examples, is in [docs/paid-call-pricing.md](docs/paid-call-pricing.md); the design decisions behind it are in [docs/adr/](docs/adr/).

## For API providers

1. **Register as a provider** — `POST /publishers` with your name, email and payout wallet. You get an API key (shown once).
2. **Register your API** — `POST /apis` with:
   - `name`, `description`, `price` (USDC per call)
   - `upstreamUrl` — your real API's base URL. Callers never see it.
   - `allowedMethods` — e.g. `["GET", "POST"]`
   - `upstreamHeader` (optional) — a secret header ZentrixPay adds to every forwarded call, such as your own API key. It is stored AES-256-GCM encrypted.
3. **Prove you own the domain** — serve the line you were given (`zentrixpay-verification=<token>`) at `https://<your-api-domain>/.well-known/zentrixpay.txt`, then `POST /apis/<id>/verify-ownership`. Your API is then listed.
4. **Get paid** — share your proxy URL `https://<zentrixpay>/api/<id>`. `GET /apis/<id>/stats` shows calls, revenue, unique payers and latency.

> **Lock your upstream down.** ZentrixPay never reveals your upstream URL, but if your API answers requests without the secret header, anyone who finds the URL can skip paying. Require the header you configured in `upstreamHeader`.

All of this is also available in the web app (**Sell your API** tab) and through the MCP tools below.

### API reference

| Endpoint                                                 | Auth        | Description                                                                                                                                                                   |
| -------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /apis?q=&tag=&limit=&offset=`                       | —           | Catalog of listed APIs                                                                                                                                                        |
| `GET /apis/:id`                                          | —           | One listed API: price, methods, payee, proxy URL                                                                                                                              |
| `GET /apis/:id/openapi.json`                             | —           | The API's OpenAPI document, with the upstream URL removed                                                                                                                     |
| `GET /.well-known/x402`                                  | —           | x402 discovery index of listed APIs                                                                                                                                           |
| `ANY /api/:id/*`                                         | x402        | A paid call, forwarded to the provider                                                                                                                                        |
| `POST /api/:id/pass`                                     | x402        | Buy a time-limited access pass                                                                                                                                                |
| `GET /payers/:address/calls`                             | wallet sig  | Paid calls made by a wallet                                                                                                                                                   |
| `GET /payers/:address/entitlements`                      | wallet sig  | Active passes and prepaid credit balances held by a wallet                                                                                                                    |
| `POST /publishers`                                       | —           | Register as a provider; returns your API key once                                                                                                                             |
| `POST /publishers/me/rotate-key`                         | `x-api-key` | Replace your API key                                                                                                                                                          |
| `GET /publishers/me/analytics`                           | `x-api-key` | Totals across all your APIs                                                                                                                                                   |
| `POST /apis`                                             | `x-api-key` | Register an API                                                                                                                                                               |
| `POST /apis/import/preview`, `POST /apis/import`         | `x-api-key` | Preview and bulk-import APIs from an OpenAPI document                                                                                                                         |
| `PATCH /apis/:id`                                        | `x-api-key` | Change price, upstream, methods, secrets, tags or listing. Changing the payee wallet also needs a signature from the current payee (`X-Payee-Timestamp`, `X-Payee-Signature`) |
| `DELETE /apis/:id`                                       | `x-api-key` | Archive an API (call history is kept)                                                                                                                                         |
| `POST /apis/:id/verify-ownership`                        | `x-api-key` | Check `/.well-known/zentrixpay.txt` (or a DNS TXT record) and list the API                                                                                                    |
| `POST /apis/:id/test-upstream`                           | `x-api-key` | Test the upstream configuration; returns status and latency only                                                                                                              |
| `GET /publishers/me/apis`                                | `x-api-key` | Your APIs, listed or not                                                                                                                                                      |
| `GET /apis/:id/stats`, `GET /apis/:id/stats/time-series` | `x-api-key` | Calls, USDC revenue, unique payers, recent calls, and daily buckets                                                                                                           |

Changing an API's upstream to a different domain un-lists it until ownership is verified again.

## For callers

- **Browser** — open the web app, connect [Freighter](https://www.freighter.app/), pick an API and use **Try it**. Each successful call is paid from your wallet.
- **Code** — wrap `fetch` with an x402 client (`@x402/fetch` + `@x402/stellar`) and call the proxy URL like any other API.
- **AI agents** — use the MCP server below.

Try the 402 yourself:

```bash
curl -i http://localhost:4021/api/<id>
# HTTP/1.1 402 Payment Required
# PAYMENT-REQUIRED: eyJ4NDAy...   (base64: price, payee, network, scheme)
```

## MCP server

The MCP server lets Claude Code, Codex or any MCP client find APIs, call them (paying per call from an agent wallet), and manage APIs as a provider.

| Tool                              | What it does                                                      |
| --------------------------------- | ----------------------------------------------------------------- |
| `zentrixpay_setup_wallet`         | Create a Stellar agent wallet (sponsored, no XLM needed up front) |
| `zentrixpay_wallet_info`          | Wallet address and USDC balance                                   |
| `zentrixpay_list_apis`            | Search the API catalog                                            |
| `zentrixpay_api_info`             | Price, methods and proxy URL for one API                          |
| `zentrixpay_call`                 | Make a paid call (method, path, query, body, headers)             |
| `zentrixpay_register`             | Register the agent as a provider                                  |
| `zentrixpay_register_api`         | Register an API to sell                                           |
| `zentrixpay_update_api`           | Change price, upstream, methods, secret header or listing         |
| `zentrixpay_verify_api_ownership` | Verify the domain and list the API                                |
| `zentrixpay_my_apis`              | Your APIs                                                         |
| `zentrixpay_api_stats`            | Calls and earnings for one API                                    |
| `zentrixpay_purchase_history`     | Paid calls this agent has made                                    |

`zentrixpay_call` checks the wallet balance before paying, refuses methods the API does not accept, and stops at the auto-pay ceiling (`ZENTRIXPAY_MAX_AUTO_PAY_USDC`, 10 USDC by default) unless you pass `maxAutoPayUsdc`. On mainnet, calls and API changes need `confirmMainnet: true` (or `ZENTRIXPAY_ALLOW_MAINNET=1`).

```bash
pnpm --filter @zentrixpay/mcp build

# Claude Code
claude mcp add zentrixpay -e ZENTRIXPAY_URL=http://localhost:4021 -- node /path/to/zentrixpay/mcp/dist/index.js

# Codex
codex mcp add zentrixpay --env ZENTRIXPAY_URL=http://localhost:4021 -- node /path/to/zentrixpay/mcp/dist/index.js
```

Set `ZENTRIXPAY_URL` to your deployment; it defaults to `http://localhost:4021`. More client configs: [docs/mcp-client-configs.md](docs/mcp-client-configs.md).

## Running locally

Requires Node.js 20+, pnpm 10 (`corepack enable`), a Postgres database, and Stellar testnet wallets (XLM from Friendbot, USDC from the [Circle faucet](https://faucet.circle.com)).

```bash
pnpm install
cp server/.env.example server/.env   # fill in the values
pnpm db:migrate
pnpm dev:server                      # API on :4021
pnpm dev:web                         # web app on :5173 (set VITE_API_URL=http://localhost:4021)
```

Proxy settings in `server/.env`:

| Variable                        | Default    | Description                                                               |
| ------------------------------- | ---------- | ------------------------------------------------------------------------- |
| `UPSTREAM_SECRET_KEY`           | _(unset)_  | 64 hex chars; encrypts providers' secret headers. Required to store them. |
| `PROXY_MAX_REQUEST_BODY`        | `5mb`      | Largest request body forwarded upstream                                   |
| `PROXY_MAX_RESPONSE_BYTES`      | `10485760` | Larger upstream responses fail with 502 and are not charged               |
| `PROXY_DEFAULT_TIMEOUT_MS`      | `15000`    | Upstream timeout when the API sets none                                   |
| `PROXY_MAX_TIMEOUT_MS`          | `25000`    | Ceiling for a provider's own timeout                                      |
| `PROXY_ALLOW_PRIVATE_UPSTREAMS` | `false`    | Local development only: allow upstreams on localhost/private networks     |

Payments are settled by the x402 facilitator (`FACILITATOR_URL`, default `https://www.x402.org/facilitator`, testnet fees sponsored).

For production incidents (facilitator or RPC outages, a full database, abuse, leaked keys, a lost `UPSTREAM_SECRET_KEY`), see the [operator runbook](docs/operator-runbook.md).

### Git hooks

[Husky](https://typicode.github.io/husky/) runs `pre-commit` (lint-staged) and `commit-msg` (commitlint) hooks through `pnpm exec`. If `pnpm` is not on your `PATH`, the hooks fall back to `npx pnpm@<version>` using the version pinned in `package.json`, so committing works on a machine with only Node.js installed. If neither is available, the hook fails with instructions: run `corepack enable` (recommended) or `npm install -g pnpm`, then `pnpm install` again.

### Contributing

1. Fork and clone the repository, run `corepack enable` and `pnpm install`.
2. Create a branch, make your change and commit; the hooks run automatically.
3. Open a pull request against `main`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions and how to pick up issues.

## Security

The proxy makes requests to URLs that providers choose, so it guards against being turned against its own network:

- Upstreams on loopback, private, link-local (including cloud metadata), and other reserved addresses are refused — at registration and again at connect time, so a domain that later re-resolves to a private address (DNS rebinding) is still blocked.
- Redirects are not followed; paths that try to climb out of the upstream base (`..`, encoded slashes) are rejected.
- Callers' cookies, payment and auth headers are stripped before forwarding; upstream cookies, CORS and x402 headers are stripped from responses.
- Responses are size-capped and every call has a timeout.

## Project structure

```
zentrixpay/
  server/     Express API, x402 paywall, pay-per-call proxy, Postgres (Drizzle)
  web/        React app: API catalog, try-it console, provider dashboard
  mcp/        MCP server for AI agents
  contract/   Soroban contracts
  packages/   Shared Stellar network and registry client
```

## Status

- **Built:** provider registration and ownership verification (well-known file or DNS TXT), the paid proxy, per-endpoint price rules, prepaid credits, access passes, free daily quota, payer allow/deny lists, streaming responses, webhooks, upstream health checks, refunds, on-chain price anchoring, x402 discovery, OpenAPI import, the web app and the MCP tools. The legacy file-vault code has been removed.
- **Being stabilized:** many of these features landed through conflicting merges, and `main` does not currently build. Progress is tracked in [#260](https://github.com/anitajordan22244-afk/zentrixpay/issues/260). Known security holes in passes and free quota ([#275](https://github.com/anitajordan22244-afk/zentrixpay/issues/275), [#276](https://github.com/anitajordan22244-afk/zentrixpay/issues/276)) must be fixed before any deployment that handles real funds.
- **Not yet built:** mainnet deployment.

## Credits

ZentrixPay started as a fork of [MindVault](https://github.com/mind-vault-1/mindvault), a payment-protected vault for digital resources on Stellar.

## License

MIT — see [LICENSE](LICENSE).
