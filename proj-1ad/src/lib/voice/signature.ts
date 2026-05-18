/**
 * AgentPhone webhook signature verification.
 *
 * Per the AgentPhone webhooks doc, each delivery carries:
 *   - X-Webhook-Signature: "sha256={hex}"
 *   - X-Webhook-Timestamp: unix seconds
 *
 * The signed string is `${timestamp}.${rawBody}`, hashed with HMAC-SHA256
 * using the per-agent secret returned at webhook creation time.
 *
 * Chunk 5 behaviour: verify and log, NEVER reject. We want noisy logs
 * during development so a misconfigured secret is obvious, but rejecting
 * would lock us out of the live phone test in the same session that
 * upserts the webhook (the secret rotates on each upsert).
 *
 * Tighten to 401-on-mismatch when the secret stabilises post-deploy.
 *
 * Docs: https://docs.agentphone.ai/documentation/guides/webhooks
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifySignatureArgs {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string;
  /** Max acceptable clock drift in seconds. AgentPhone docs say 5min. */
  maxAgeSeconds?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verifyAgentPhoneSignature(
  args: VerifySignatureArgs,
): VerifyResult {
  const { rawBody, signatureHeader, timestampHeader, secret } = args;

  if (!signatureHeader) {
    return { ok: false, reason: "missing X-Webhook-Signature header" };
  }
  if (!timestampHeader) {
    return { ok: false, reason: "missing X-Webhook-Timestamp header" };
  }

  const ts = Number.parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: `invalid timestamp: ${timestampHeader}` };
  }

  const maxAge = args.maxAgeSeconds ?? 300;
  const driftSeconds = Math.abs(Date.now() / 1000 - ts);
  if (driftSeconds > maxAge) {
    return {
      ok: false,
      reason: `timestamp drift ${Math.round(driftSeconds)}s exceeds ${maxAge}s`,
    };
  }

  const signed = `${timestampHeader}.${rawBody}`;
  const expectedHex = createHmac("sha256", secret).update(signed).digest("hex");
  const expectedHeader = `sha256=${expectedHex}`;

  // Constant-time compare. Buffers must be equal length for
  // timingSafeEqual; we pre-check to avoid throwing on a length mismatch.
  const a = Buffer.from(expectedHeader);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
