/**
 * AgentMail REST client.
 *
 * Single-purpose: `sendEmail({ to, subject, text, html? })` from our
 * production inbox (`AGENTMAIL_INBOX_ID`). Used by playbooks that need
 * to loop a human in — primarily the change-of-plans playbook flagging
 * scheduling conflicts to the line producer.
 *
 * Why this exists when an SDK is installed:
 *   - The SDK is CJS-first and the rest of our `@/lib/*` modules are
 *     plain `fetch` wrappers (matches the AgentPhone client). One
 *     consistent shape across both telephony + email keeps the
 *     debugging story short: every external call lands in a small
 *     `try / non-ok → throw / json` block we control.
 *   - We never pay for an extra dependency layer to do a one-endpoint
 *     send.
 *
 * Dev override: respects `TEST_EMAIL_OVERRIDE`. If set, every send is
 * rerouted there regardless of the intended recipient. The intended
 * `to` is logged so playbook code that records "we emailed the line
 * producer" stays accurate while you, physically, receive the email.
 *
 * Docs: https://docs.agentmail.to/api-reference/inboxes/messages/send
 */

const BASE_URL = "https://api.agentmail.to/v0";

function requireApiKey(): string {
  const key = process.env.AGENTMAIL_API_KEY;
  if (!key) throw new Error("AGENTMAIL_API_KEY is not set");
  return key;
}

function requireInboxId(): string {
  const id = process.env.AGENTMAIL_INBOX_ID;
  if (!id) throw new Error("AGENTMAIL_INBOX_ID is not set");
  return id;
}

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  /** Plain-text body. Always include even when `html` is set. */
  text: string;
  /** Optional rich body. */
  html?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string | string[];
  /** Override the env-default inbox. Rarely needed. */
  inboxId?: string;
}

export interface SentEmail {
  /** AgentMail's message id (`msg_…`). Stored as `emails.agentmail_message_id`. */
  messageId?: string;
  /** Echoed for our logs only. */
  to: string[];
  subject: string;
  /** Raw response body in case callers want to inspect anything else. */
  raw: unknown;
}

function asArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * Send one email via AgentMail. Throws on non-2xx so callers can
 * record an `email.send_failed` event and degrade gracefully.
 *
 * Implementation note: AgentMail's `POST /inboxes/{inbox_id}/messages`
 * accepts both `to` and arrays — we always send arrays for
 * uniformity. The dev override kicks in here, replacing the entire
 * recipient list with `TEST_EMAIL_OVERRIDE`.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SentEmail> {
  const apiKey = requireApiKey();
  const inboxId = args.inboxId ?? requireInboxId();

  const intendedTo = asArray(args.to);
  const override = process.env.TEST_EMAIL_OVERRIDE;
  const to = override && override.length > 0 ? [override] : intendedTo;
  if (override && override.length > 0 && intendedTo.join(",") !== override) {
    console.log(
      `[agentmail] dev-override: would have emailed ${intendedTo.join(", ")}, emailing ${override} instead`,
    );
  }

  const payload: Record<string, unknown> = {
    to,
    subject: args.subject,
    text: args.text,
  };
  if (args.html) payload.html = args.html;
  const cc = asArray(args.cc);
  if (cc.length > 0) payload.cc = cc;
  const bcc = asArray(args.bcc);
  if (bcc.length > 0) payload.bcc = bcc;
  const replyTo = asArray(args.replyTo);
  if (replyTo.length > 0) payload.replyTo = replyTo;

  const res = await fetch(
    `${BASE_URL}/inboxes/${encodeURIComponent(inboxId)}/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `AgentMail POST /inboxes/${inboxId}/messages/send failed: ${res.status} ${res.statusText} — ${body}`,
    );
  }

  const raw = (await res.json()) as Record<string, unknown>;

  // AgentMail returns different shapes across versions of the API and
  // SDK examples — `message_id`, `messageId`, `id`. Probe all of them
  // so we don't bork the DB insert on a field name drift.
  const messageId =
    (typeof raw.message_id === "string" && raw.message_id) ||
    (typeof raw.messageId === "string" && raw.messageId) ||
    (typeof raw.id === "string" && raw.id) ||
    undefined;

  return {
    messageId: messageId || undefined,
    to,
    subject: args.subject,
    raw,
  };
}
