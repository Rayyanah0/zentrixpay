/// <reference path="../types/freighter.d.ts" />
import { networks } from "@zentrixpay/registry-client";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export interface PayerPass {
  passId: string;
  apiId: string;
  apiName: string;
  activeFrom: string;
  expiresAt: string;
}

export interface PayerCreditBalance {
  apiId: string;
  apiName: string;
  balance: number;
  updatedAt: string;
}

export interface PayerEntitlements {
  payer: string;
  passes: PayerPass[];
  credits: PayerCreditBalance[];
}

/** Signs a UTF-8 message with the wallet and returns a base64 Ed25519 signature. */
export type MessageSigner = (message: string, address: string) => Promise<string>;

/**
 * The challenge the server's walletSignatureAuth verifies
 * (server/src/lib/walletSignature.ts). Keep the two in sync.
 */
export function buildWalletAuthMessage(input: {
  method: string;
  path: string;
  walletAddress: string;
  timestamp: string;
}): string {
  return [
    "zentrixpay:wallet-auth",
    input.method.toUpperCase(),
    input.path,
    input.walletAddress,
    input.timestamp,
  ].join("\n");
}

function toBase64(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    let binary = "";
    for (const byte of value) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  throw new Error("Freighter returned an unexpected signature format.");
}

function networkPassphrase(): string {
  const raw = (import.meta.env.VITE_STELLAR_NETWORK as string | undefined)?.trim().toLowerCase();
  const preset =
    raw === "public" || raw === "mainnet" || raw === "pubnet" ? networks.mainnet : networks.testnet;
  return preset.networkPassphrase;
}

/** Sign with Freighter (SEP-53 message signing). */
export const freighterMessageSigner: MessageSigner = async (message, address) => {
  const { signMessage } = await import("@stellar/freighter-api");
  const result = (await signMessage(message, {
    address,
    networkPassphrase: networkPassphrase(),
  })) as { signedMessage?: unknown; error?: { message?: string } | string };
  if (result.error) {
    const text = typeof result.error === "string" ? result.error : result.error.message;
    throw new Error(text || "Freighter refused to sign the request.");
  }
  if (!result.signedMessage) throw new Error("Freighter did not return a signature.");
  return toBase64(result.signedMessage);
};

/** GET /payers/:address/entitlements, signed by the wallet. */
export async function fetchEntitlements(
  address: string,
  signer: MessageSigner = freighterMessageSigner,
  signal?: AbortSignal,
): Promise<PayerEntitlements> {
  const path = `/payers/${encodeURIComponent(address)}/entitlements`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signer(
    buildWalletAuthMessage({ method: "GET", path, walletAddress: address, timestamp }),
    address,
  );

  const res = await fetch(new URL(`${API_BASE}${path}`, window.location.origin), {
    headers: { "X-Wallet-Timestamp": timestamp, "X-Wallet-Signature": signature },
    signal,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (HTTP ${res.status})`;
    throw new Error(message);
  }
  return body as PayerEntitlements;
}
