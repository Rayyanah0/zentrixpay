import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { publishers } from "../db/schema.js";
import { generateApiKey, hashApiKey } from "../utils/crypto.js";

export async function registerPublisher(data: {
  name: string;
  email: string;
  walletAddress: string;
}) {
  const apiKey = generateApiKey();
  const apiKeyHash = hashApiKey(apiKey);

  const [publisher] = await db
    .insert(publishers)
    .values({
      name: data.name,
      email: data.email,
      walletAddress: data.walletAddress,
      apiKeyHash,
    })
    .returning();

  return { publisher, apiKey };
}

/**
 * Replace a publisher's API key. The new key is returned once; only its hash is
 * stored, so the old key stops authenticating as soon as this commits.
 */
export async function rotatePublisherKey(publisherId: string) {
  const apiKey = generateApiKey();
  const [publisher] = await db
    .update(publishers)
    .set({ apiKeyHash: hashApiKey(apiKey) })
    .where(eq(publishers.id, publisherId))
    .returning();
  return { publisher, apiKey };
}

export async function getPublisherById(id: string) {
  return db
    .select()
    .from(publishers)
    .where(eq(publishers.id, id))
    .then((rows) => rows[0] ?? null);
}

/**
 * Simple pluggable mail transport used for provider notifications.
 * The default transport logs to console; tests can replace it with a fake.
 */
export interface MailTransport {
  /**
   * Send an email.
   * @param options - Object containing recipient, subject and plain‑text body.
   */
  sendMail(options: { to: string; subject: string; text: string }): Promise<void>;
}

// Default transport – logs to stdout. In production this could be swapped for an SMTP implementation.
let mailTransport: MailTransport = {
  async sendMail({ to, subject, text }) {
    // Minimal placeholder implementation; replace with real SMTP logic as needed.
    console.log(`Mail to ${to} | Subject: ${subject}\n${text}`);
  },
};

/**
 * Override the mail transport – useful for tests that provide a fake implementation.
 */
export function setMailTransport(transport: MailTransport) {
  mailTransport = transport;
}

/**
 * Send a notification email to a provider.
 * @param email - Provider's email address.
 * @param subject - Email subject line.
 * @param body - Plain‑text email body.
 */
export async function sendProviderNotification(
  email: string,
  subject: string,
  body: string,
): Promise<void> {
  // In a real system we would respect provider opt‑out preferences here.
  await mailTransport.sendMail({ to: email, subject, text: body });
}
