import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CallerEntitlements } from "./CallerEntitlements.js";
import type { WalletState } from "../hooks/useWalletConnection.js";

// Issue #292: a caller sees their active passes and credit balances.

const ADDRESS = "GCALLERADDRESSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const NOW = new Date("2026-11-21T10:00:00.000Z");

function wallet(overrides: Partial<WalletState> = {}): WalletState {
  return {
    status: "connected",
    address: ADDRESS,
    error: null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    ...overrides,
  };
}

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CallerEntitlements", () => {
  it("asks the caller to connect a wallet first", () => {
    render(<CallerEntitlements wallet={wallet({ status: "disconnected", address: null })} />);
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows active passes and credit balances after a signed request", async () => {
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          payer: ADDRESS,
          passes: [
            {
              passId: "pass-1",
              apiId: "api-1",
              apiName: "Weather",
              activeFrom: "2026-11-21T09:30:00.000Z",
              expiresAt: "2026-11-21T10:45:00.000Z",
            },
          ],
          credits: [
            {
              apiId: "api-2",
              apiName: "Geocoder",
              balance: 25,
              updatedAt: "2026-11-21T09:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const signer = vi.fn().mockResolvedValue("c2lnbmF0dXJl");

    render(<CallerEntitlements wallet={wallet()} signer={signer} now={() => NOW} />);
    await userEvent.click(screen.getByRole("button", { name: /show my passes and credits/i }));

    await waitFor(() => expect(screen.getByText("Weather")).toBeInTheDocument());
    expect(screen.getByText("Expires in 45 minutes")).toBeInTheDocument();
    expect(screen.getByText("Geocoder")).toBeInTheDocument();
    expect(screen.getByText("25 calls left")).toBeInTheDocument();

    const [message, signedFor] = signer.mock.calls[0];
    expect(signedFor).toBe(ADDRESS);
    expect(message).toMatch(
      new RegExp(
        `^zentrixpay:wallet-auth\\nGET\\n/payers/${ADDRESS}/entitlements\\n${ADDRESS}\\n\\d+$`,
      ),
    );

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain(`/payers/${ADDRESS}/entitlements`);
    expect(init.headers["X-Wallet-Signature"]).toBe("c2lnbmF0dXJl");
    expect(init.headers["X-Wallet-Timestamp"]).toMatch(/^\d+$/);
  });

  it("shows empty states when the wallet holds nothing", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ payer: ADDRESS, passes: [], credits: [] }), { status: 200 }),
    );

    render(<CallerEntitlements wallet={wallet()} signer={vi.fn().mockResolvedValue("sig")} />);
    await userEvent.click(screen.getByRole("button", { name: /show my passes and credits/i }));

    await waitFor(() => expect(screen.getByText("No active passes.")).toBeInTheDocument());
    expect(screen.getByText("No prepaid credits.")).toBeInTheDocument();
  });

  it("reports a refused signature or server error", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: "X-Wallet-Signature does not match the wallet" }), {
        status: 401,
      }),
    );

    render(<CallerEntitlements wallet={wallet()} signer={vi.fn().mockResolvedValue("sig")} />);
    await userEvent.click(screen.getByRole("button", { name: /show my passes and credits/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/does not match the wallet/);
  });
});
