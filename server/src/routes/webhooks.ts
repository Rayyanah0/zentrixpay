import { Router, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.js";
import { apis } from "../db/schema.js";
import { apiKeyAuth } from "../middleware/apiKeyAuth.js";
import { requestSignatureAuth } from "../middleware/requestSignatureAuth.js";
import {
  expireWebhookPreviousSecret,
  rotateWebhookSecret,
  WEBHOOK_ROTATION_GRACE_MS,
} from "../services/webhookService.js";

const router = Router();

async function loadOwnedApi(id: string, publisherId: string) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  const [row] = await db
    .select()
    .from(apis)
    .where(and(eq(apis.id, numericId), eq(apis.publisherId, publisherId), isNull(apis.archivedAt)))
    .limit(1);
  return row ?? null;
}

// POST /apis/:id/webhook/secret/rotate — issue a new webhook signing secret (owner, #211).
// The previous secret keeps signing for a grace period. The new secret is returned once.
router.post(
  "/apis/:id/webhook/secret/rotate",
  apiKeyAuth,
  requestSignatureAuth,
  async (req: Request, res: Response) => {
    const api = await loadOwnedApi(req.params.id as string, req.publisher!.id);
    if (!api) {
      res.status(404).json({ error: "API not found" });
      return;
    }
    if (!api.webhookUrl) {
      res.status(409).json({ error: "Set a webhook URL before rotating its secret" });
      return;
    }
    const secret = await rotateWebhookSecret(api);
    res.setHeader("Cache-Control", "no-store");
    res.json({ apiId: api.id, secret, previousSecretExpiresInMs: WEBHOOK_ROTATION_GRACE_MS });
  },
);

// POST /apis/:id/webhook/secret/expire — end the previous secret's grace period now (owner, #211).
router.post(
  "/apis/:id/webhook/secret/expire",
  apiKeyAuth,
  requestSignatureAuth,
  async (req: Request, res: Response) => {
    const api = await loadOwnedApi(req.params.id as string, req.publisher!.id);
    if (!api) {
      res.status(404).json({ error: "API not found" });
      return;
    }
    await expireWebhookPreviousSecret(api);
    res.json({ apiId: api.id, previousSecretExpired: true });
  },
);

export default router;
