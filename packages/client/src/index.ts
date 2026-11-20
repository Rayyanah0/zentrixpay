import { Keypair } from "@stellar/stellar-sdk";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import type { Network } from "@x402/fetch";
import type { PaymentResponse } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createSigner } from "@x402/stellar";
import type { ClientStellarSigner } from "@x402/stellar";

export interface Signer extends ClientStellarSigner {}
export type FreighterSignerAdapter = Pick<Signer, "address" | "signAuthEntry" | "signTransaction">;

export function createKeypairSigner(secretKey: string): Signer {
  return createKeypairSignerFromKeypair(Keypair.fromSecret(secretKey));
}

export function createKeypairSignerFromKeypair(keypair: Keypair): Signer {
  return createSigner(keypair) as Signer;
}

/** Adapt Freighter (or another browser wallet) without ever accepting a secret key. */
export function createFreighterSigner(adapter: FreighterSignerAdapter): Signer {
  return adapter;
}

export interface CallApiOptions {
  method?: string;
  path: string;
  query?: Record<string, string | number | boolean | string[]>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  body: T;
  payment?: PaymentResponse;
}

export class ProxyApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason?: string;
  readonly details?: unknown;
  constructor(input: { status: number; code: string; message: string; reason?: string; details?: unknown }) {
    super(input.message);
    this.name = "ProxyApiError";
    this.status = input.status;
    this.code = input.code;
    this.reason = input.reason;
    this.details = input.details;
  }
}

export class UpstreamApiError extends ProxyApiError {}
export class PaymentRequiredError extends ProxyApiError {}
export class RateLimitApiError extends ProxyApiError {}

function callUrl(baseUrl: string, path: string, query?: CallApiOptions["query"]): string {
  const url = /^https?:\/\//i.test(path) ? new URL(path) : new URL(`${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item));
  }
  return url.toString();
}

function errorFromResponse(status: number, body: unknown): ProxyApiError {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const code = typeof record.code === "string" ? record.code : typeof record.error === "string" ? record.error : "HTTP_ERROR";
  const reason = typeof record.reason === "string" ? record.reason : undefined;
  const message = typeof record.message === "string" ? record.message : typeof record.error === "string" ? record.error : `Request failed (HTTP ${status})`;
  const input = { status, code, reason, details: body, message };
  if (status === 402 || code === "PAYMENT_REQUIRED") return new PaymentRequiredError(input);
  if (status === 429 || code === "RATE_LIMITED") return new RateLimitApiError(input);
  if (code === "upstream_failed" || ["blocked", "network", "too_large", "timeout"].includes(reason ?? "")) return new UpstreamApiError(input);
  return new ProxyApiError(input);
}

export async function callApi<T = unknown>(baseUrl: string, options: CallApiOptions & { signer: Signer; network?: Network }): Promise<ApiResponse<T>> {
  const method = (options.method ?? "GET").toUpperCase();
  const headers = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (method !== "GET" && options.body !== undefined) {
    body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    if (!Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
  }
  const client = new x402Client().register(options.network ?? ("stellar:testnet" as Network), new ExactStellarScheme(options.signer));
  const response = await wrapFetchWithPayment(fetch, client)(callUrl(baseUrl, options.path, options.query), { method, headers, body });
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => { responseHeaders[key.toLowerCase()] = value; });
  const text = await response.text();
  let parsed: unknown = text;
  if ((response.headers.get("content-type") ?? "").includes("application/json") && text) {
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
  }
  if (!response.ok) throw errorFromResponse(response.status, parsed);
  const paymentHeader = response.headers.get("x-payment-response") ?? response.headers.get("payment-response");
  return { status: response.status, headers: responseHeaders, body: parsed as T, payment: paymentHeader ? decodePaymentResponseHeader(paymentHeader) : undefined };
}
