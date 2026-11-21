import { and, asc, eq, gt, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { apiCreditBalances, apiPasses, apis } from "../db/schema.js";

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

/**
 * What a wallet currently holds: passes that are active right now (soonest
 * expiry first) and every non-zero prepaid credit balance, per API.
 */
export async function listPayerEntitlements(
  walletAddress: string,
  now: Date = new Date(),
): Promise<PayerEntitlements> {
  const [passRows, creditRows] = await Promise.all([
    db
      .select({
        passId: apiPasses.id,
        apiId: apiPasses.apiId,
        apiName: apis.name,
        activeFrom: apiPasses.activeFrom,
        expiresAt: apiPasses.expiresAt,
      })
      .from(apiPasses)
      .innerJoin(apis, eq(apis.id, apiPasses.apiId))
      .where(
        and(
          eq(apiPasses.payerAddress, walletAddress),
          lte(apiPasses.activeFrom, now),
          gt(apiPasses.expiresAt, now),
        ),
      )
      .orderBy(asc(apiPasses.expiresAt)),
    db
      .select({
        apiId: apiCreditBalances.apiId,
        apiName: apis.name,
        balance: apiCreditBalances.balance,
        updatedAt: apiCreditBalances.updatedAt,
      })
      .from(apiCreditBalances)
      .innerJoin(apis, eq(apis.id, apiCreditBalances.apiId))
      .where(and(eq(apiCreditBalances.walletAddress, walletAddress), gt(apiCreditBalances.balance, 0)))
      .orderBy(asc(apis.name)),
  ]);

  return {
    payer: walletAddress,
    passes: passRows.map((row) => ({
      passId: row.passId,
      apiId: row.apiId,
      apiName: row.apiName,
      activeFrom: row.activeFrom.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    })),
    credits: creditRows.map((row) => ({
      apiId: row.apiId,
      apiName: row.apiName,
      balance: row.balance,
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
