# @zentrixpay/client

A small TypeScript client for ZentrixPay's x402-paid proxy. `callApi` accepts an API base URL and `{ method, path, query, body }`, retries a `402 Payment Required` challenge with a signer, and returns a typed response.

```bash
npm install @zentrixpay/client
```

## Keypair (Node)

```ts
import { callApi, createKeypairSigner } from "@zentrixpay/client";

const signer = createKeypairSigner(process.env.STELLAR_SECRET_KEY!);
const response = await callApi("https://pay.example/api/my-api", {
  signer,
  method: "POST",
  path: "/v1/forecast",
  query: { units: "metric" },
  body: { city: "Lisbon" },
});
console.log(response.status, response.body);
```

Keep the secret in a server-side environment variable or secret manager. Never put a secret key in browser code, logs, or a frontend bundle.

## Freighter or another wallet

The browser app can pass a `ClientStellarSigner` adapter that delegates `signAuthEntry` and `signTransaction` to the wallet extension. The package never reads or stores a browser secret:

```ts
import { callApi, createFreighterSigner } from "@zentrixpay/client";
const signer = createFreighterSigner({ address, signAuthEntry, signTransaction });
const response = await callApi(proxyUrl, { signer, method: "GET", path: "/v1/status" });
```

## Errors

Non-2xx responses throw `ProxyApiError`. `PaymentRequiredError`, `RateLimitApiError`, and `UpstreamApiError` are subclasses with `status`, `code`, `reason`, and `details` fields.
