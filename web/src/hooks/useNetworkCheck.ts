/**
 * Checks that Freighter's active network matches the passphrase the server
 * returned. Returns a warning string when they differ, or null when they match.
 */
export async function checkNetwork(expectedPassphrase: string): Promise<string | null> {
  // First, verify that the user's Freighter wallet is on the expected network.
  const freighter = await import("@stellar/freighter-api");
  const result = await freighter.getNetworkDetails();
  if ("error" in result && result.error) return null; // can't check — let signing handle it
  const actual = (result as any).networkPassphrase ?? (result as any).result?.networkPassphrase;
  if (!actual || actual === expectedPassphrase) {
    // Networks match – now enforce mainnet confirmation if needed.
    if (expectedPassphrase.includes("Public")) {
      // Mainnet detected. Require explicit user confirmation before any paid call.
      const confirmed = sessionStorage.getItem("zentrixpay_mainnet_confirmed");
      if (confirmed !== "true") {
        return "Mainnet operations require explicit confirmation. Please confirm to proceed.";
      }
    }
    return null;
  }
  const label = expectedPassphrase.includes("Test")
    ? "Stellar Testnet"
    : expectedPassphrase.includes("Public")
      ? "Stellar Mainnet"
      : expectedPassphrase;
  return `Network mismatch: your wallet is on a different network. Switch Freighter to ${label} before signing.`;
}

/**
 * Call this function (e.g., from a UI confirmation dialog) to record that the user
 * has explicitly confirmed they want to interact with the mainnet for the current
 * browser session.
 */
export function confirmMainnetSession(): void {
  try {
    sessionStorage.setItem("zentrixpay_mainnet_confirmed", "true");
  } catch {
    // Silently ignore storage errors – the warning will continue to appear.
  }
}

/**
 * Reset the mainnet confirmation flag. Useful for testing or when the user logs
 * out / changes network.
 */
export function resetMainnetConfirmation(): void {
  try {
    sessionStorage.removeItem("zentrixpay_mainnet_confirmed");
  } catch {
    // No‑op on storage failure.
  }
}
  const freighter = await import("@stellar/freighter-api");
  const result = await freighter.getNetworkDetails();
  if ("error" in result && result.error) return null; // can't check — let signing handle it
  const actual = (result as any).networkPassphrase ?? (result as any).result?.networkPassphrase;
  if (!actual || actual === expectedPassphrase) return null;
  const label = expectedPassphrase.includes("Test")
    ? "Stellar Testnet"
    : expectedPassphrase.includes("Public")
      ? "Stellar Mainnet"
      : expectedPassphrase;
  return `Network mismatch: your wallet is on a different network. Switch Freighter to ${label} before signing.`;
}
