import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WalletState } from "../hooks/useWalletConnection.js";
import {
  fetchEntitlements,
  freighterMessageSigner,
  type MessageSigner,
  type PayerEntitlements,
} from "../api/entitlements.js";

interface Props {
  wallet: WalletState;
  /** Injected in tests; defaults to Freighter message signing. */
  signer?: MessageSigner;
  /** Injected in tests; defaults to the wall clock. */
  now?: () => Date;
}

function remaining(expiresAt: string, now: Date, t: (key: string, opts?: object) => string) {
  const minutes = Math.max(0, Math.round((new Date(expiresAt).getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return t("access.expires_in_minutes", { count: minutes });
  return t("access.expires_in_hours", { count: Math.round(minutes / 60) });
}

/**
 * Caller view (#292): the connected wallet's active access passes and prepaid
 * credit balances. Loading signs a wallet-auth challenge, so it happens on
 * request rather than on mount.
 */
export function CallerEntitlements({ wallet, signer = freighterMessageSigner, now }: Props) {
  const { t } = useTranslation();
  const [data, setData] = useState<PayerEntitlements | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const address = wallet.status === "connected" ? wallet.address : null;

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchEntitlements(address, signer));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("access.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [address, signer, t]);

  if (!address) {
    return (
      <section aria-labelledby="access-heading" className="space-y-3">
        <h2 id="access-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("access.heading")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">{t("access.connect_prompt")}</p>
      </section>
    );
  }

  const shownFor = data?.payer === address ? data : null;
  const current = now?.() ?? new Date();

  return (
    <section aria-labelledby="access-heading" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="access-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("access.heading")}
        </h2>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {loading ? t("access.loading") : shownFor ? t("access.refresh") : t("access.load")}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {shownFor && (
        <>
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t("access.passes_heading")}
            </h3>
            {shownFor.passes.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("access.no_passes")}</p>
            ) : (
              <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
                {shownFor.passes.map((pass) => (
                  <li
                    key={pass.passId}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {pass.apiName}
                    </span>
                    <time
                      dateTime={pass.expiresAt}
                      title={new Date(pass.expiresAt).toLocaleString()}
                      className="text-gray-600 dark:text-gray-400"
                    >
                      {remaining(pass.expiresAt, current, t)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
              {t("access.credits_heading")}
            </h3>
            {shownFor.credits.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t("access.no_credits")}</p>
            ) : (
              <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
                {shownFor.credits.map((credit) => (
                  <li
                    key={credit.apiId}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {credit.apiName}
                    </span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {t("access.credits_left", { count: credit.balance })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
