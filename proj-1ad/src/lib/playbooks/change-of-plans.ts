/**
 * Change-of-plans playbook.
 *
 * Triggered by the AgentPhone `call_ended` webhook AFTER the call has
 * been persisted. Behaviour branches on `calls.playbook`:
 *
 *   • The call we just finished was the original "Maya called and
 *     raised a conflict" call (i.e. `calls.playbook` is null):
 *       1. Look up every `risks` row opened during this call (the
 *          in-call `record_conflict` tool writes them with
 *          `context.callDbId = <this call's uuid>`).
 *       2. For each conflict, email the line producer with structured
 *          details (original time, proposed alt, reason).
 *       3. If the contact volunteered a specific alternative time
 *          (`proposedCallAt`), find their scene-mates on that shoot
 *          day (cast in the same scenes) and enqueue renegotiation
 *          calls — first one fires immediately, the rest chain off
 *          subsequent `call_ended` events.
 *
 *   • The call we just finished WAS a renegotiation call (i.e.
 *     `calls.playbook === "change_of_plans"`):
 *       1. Dispatch the next queued renegotiation for this production.
 *          Whatever conflict that peer may have raised on THEIR call
 *          is still durable in `risks` for the dashboard, but we do
 *          NOT cascade another email — the line producer already
 *          knows.
 *
 * The queue is a module-level `Map<productionId, QueuedRenegotiation[]>`.
 * State is lost on Next.js hot reload or process restart; acceptable
 * for the day-2 demo. Day 3+ should persist it in a `playbook_runs`
 * table so reschedules survive deploys.
 *
 * All failures are caught and logged; this module is invoked
 * fire-and-forget by the webhook so it never throws upstream.
 */
import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  callTimes,
  calls,
  contacts,
  emails,
  productions,
  risks,
  sceneCast,
  scenes,
} from "@/db/schema";
import { recordEvent } from "@/lib/orchestrator/events";
import { sendEmail } from "@/lib/email/agentmail";
import { placeCall } from "@/lib/voice/agentphone";

/**
 * In-memory queue of pending renegotiation calls, keyed by productionId.
 * Each entry carries everything the dispatcher needs to build the
 * per-call purpose string without a second DB round-trip.
 */
interface QueuedRenegotiation {
  productionId: string;
  peerContactId: string;
  conflictContactName: string;
  conflictContactRole: string;
  origCallAtISO: string;
  proposedCallAtISO: string;
  proposedReason: string | null;
  shootDay: number;
  conflictRiskId: string;
}
const renegotiationQueue = new Map<string, QueuedRenegotiation[]>();

const PLAYBOOK_TAG = "change_of_plans" as const;

/* ──────────────────────────────────────────────────────────────────── */
/* Entry point                                                           */
/* ──────────────────────────────────────────────────────────────────── */

export async function runChangeOfPlansPlaybook(
  callDbId: string,
): Promise<void> {
  try {
    const [callRow] = await db
      .select({
        id: calls.id,
        productionId: calls.productionId,
        playbook: calls.playbook,
        contactId: calls.contactId,
      })
      .from(calls)
      .where(eq(calls.id, callDbId))
      .limit(1);

    if (!callRow) {
      console.warn(`[change-of-plans] call ${callDbId} not found`);
      return;
    }

    // This call was placed BY the playbook → just chain the next
    // queued renegotiation, don't cascade email/queue logic.
    if (callRow.playbook === PLAYBOOK_TAG) {
      await dispatchNextFromQueue(callRow.productionId);
      return;
    }

    // Otherwise: scan for conflicts opened during this call and
    // trigger the full playbook for each.
    const conflicts = await db
      .select()
      .from(risks)
      .where(
        and(
          eq(risks.kind, "contact_conflict"),
          sql`${risks.context}->>'callDbId' = ${callDbId}`,
        ),
      );

    if (conflicts.length === 0) {
      // Nothing to do — the call ended cleanly with no conflict.
      return;
    }

    console.log(
      `[change-of-plans] call ${callDbId} surfaced ${conflicts.length} conflict(s); running playbook`,
    );

    for (const conflict of conflicts) {
      await handleOneConflict(conflict);
    }
  } catch (err) {
    console.error("[change-of-plans] unexpected failure:", err);
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* Per-conflict handling                                                 */
/* ──────────────────────────────────────────────────────────────────── */

interface ConflictContext {
  description?: string;
  proposedCallAt?: string | null;
  proposedReason?: string | null;
  contactId?: string;
  callDbId?: string;
  agentphoneCallId?: string;
}

async function handleOneConflict(risk: {
  id: string;
  productionId: string;
  context: unknown;
}): Promise<void> {
  const ctx = (risk.context ?? {}) as ConflictContext;
  if (!ctx.contactId) {
    console.warn(
      `[change-of-plans] risk ${risk.id} has no contactId in context; skipping`,
    );
    return;
  }

  const productionId = risk.productionId;
  const conflictContactId = ctx.contactId;

  // Hydrate everything we need for the email + queue purpose strings.
  const [
    [conflictContact],
    [production],
    [lineProducer],
    [conflictCallTime],
  ] = await Promise.all([
    db.select().from(contacts).where(eq(contacts.id, conflictContactId)).limit(1),
    db.select().from(productions).where(eq(productions.id, productionId)).limit(1),
    db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.productionId, productionId),
          eq(contacts.role, "line_producer"),
        ),
      )
      .limit(1),
    db
      .select()
      .from(callTimes)
      .where(
        and(
          eq(callTimes.contactId, conflictContactId),
          gt(callTimes.callAt, new Date()),
        ),
      )
      .orderBy(asc(callTimes.callAt))
      .limit(1),
  ]);

  if (!conflictContact || !production) {
    console.warn(
      `[change-of-plans] missing contact/production for risk ${risk.id}`,
    );
    return;
  }
  if (!lineProducer) {
    console.warn(
      `[change-of-plans] production ${productionId} has no line_producer contact; cannot notify`,
    );
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.skipped",
      severity: "watch",
      payload: { riskId: risk.id, reason: "no_line_producer_on_record" },
    });
    return;
  }
  if (!lineProducer.email) {
    console.warn(
      `[change-of-plans] line producer ${lineProducer.id} has no email on file`,
    );
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.skipped",
      severity: "watch",
      payload: { riskId: risk.id, reason: "line_producer_email_missing" },
    });
    return;
  }
  if (!conflictCallTime) {
    console.warn(
      `[change-of-plans] contact ${conflictContactId} has no upcoming call_time; using "their next call" wording`,
    );
  }

  // === Action A: Email line producer ===
  await emailLineProducer({
    productionId,
    productionName: production.name,
    productionInbox: production.agentmailInbox,
    lineProducerEmail: lineProducer.email,
    lineProducerContactId: lineProducer.id,
    conflictContact: {
      id: conflictContact.id,
      name: conflictContact.name,
      role: conflictContact.role,
    },
    origCallAt: conflictCallTime?.callAt ?? null,
    shootDay: conflictCallTime?.shootDay ?? null,
    proposedCallAtISO: ctx.proposedCallAt ?? null,
    proposedReason: ctx.proposedReason ?? null,
    description: ctx.description ?? "(no description)",
    riskId: risk.id,
  });

  // === Action B: Enqueue renegotiation calls (only when we have an alt) ===
  if (!ctx.proposedCallAt) {
    console.log(
      `[change-of-plans] risk ${risk.id} has no proposedCallAt — email-only, no reschedule calls`,
    );
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.complete",
      severity: "watch",
      payload: {
        riskId: risk.id,
        mode: "email_only",
        reason: "no_proposed_alt",
      },
    });
    return;
  }

  if (!conflictCallTime) {
    console.warn(
      `[change-of-plans] cannot enqueue scene-mates without conflict contact's call_time`,
    );
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.complete",
      severity: "watch",
      payload: { riskId: risk.id, mode: "email_only", reason: "no_call_time" },
    });
    return;
  }

  const sceneMates = await findSceneMates(
    productionId,
    conflictContactId,
    conflictCallTime.shootDay,
  );

  if (sceneMates.length === 0) {
    console.log(
      `[change-of-plans] no scene-mates found for ${conflictContact.name} on shoot day ${conflictCallTime.shootDay}`,
    );
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.complete",
      severity: "watch",
      payload: {
        riskId: risk.id,
        mode: "email_only",
        reason: "no_scene_mates",
      },
    });
    return;
  }

  // Enqueue everyone, then kick the first.
  const items: QueuedRenegotiation[] = sceneMates.map((m) => ({
    productionId,
    peerContactId: m.id,
    conflictContactName: conflictContact.name,
    conflictContactRole: conflictContact.role,
    origCallAtISO: conflictCallTime.callAt.toISOString(),
    proposedCallAtISO: ctx.proposedCallAt!,
    proposedReason: ctx.proposedReason ?? null,
    shootDay: conflictCallTime.shootDay,
    conflictRiskId: risk.id,
  }));
  appendToQueue(productionId, items);

  await recordEvent({
    productionId,
    kind: "playbook.change_of_plans.queued",
    severity: "watch",
    payload: {
      riskId: risk.id,
      peerCount: items.length,
      peerNames: sceneMates.map((m) => m.name),
    },
  });

  // Kick the first call. Subsequent calls chain off `call_ended` for
  // each renegotiation call (route.ts → runChangeOfPlansPlaybook →
  // dispatchNextFromQueue when callRow.playbook === "change_of_plans").
  await dispatchNextFromQueue(productionId);
}

/* ──────────────────────────────────────────────────────────────────── */
/* Queue + dispatch                                                      */
/* ──────────────────────────────────────────────────────────────────── */

function appendToQueue(
  productionId: string,
  items: QueuedRenegotiation[],
): void {
  const existing = renegotiationQueue.get(productionId) ?? [];
  renegotiationQueue.set(productionId, existing.concat(items));
}

async function dispatchNextFromQueue(productionId: string): Promise<void> {
  const q = renegotiationQueue.get(productionId);
  if (!q || q.length === 0) {
    // Nothing to do — either no playbook is running or we just dequeued
    // the tail.
    return;
  }
  const next = q.shift()!;
  if (q.length === 0) renegotiationQueue.delete(productionId);

  const [peer] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, next.peerContactId))
    .limit(1);

  if (!peer) {
    console.warn(
      `[change-of-plans] queued peer ${next.peerContactId} not found in contacts; skipping to next`,
    );
    await dispatchNextFromQueue(productionId);
    return;
  }
  if (!peer.phone) {
    console.warn(
      `[change-of-plans] peer ${peer.name} has no phone; skipping to next`,
    );
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.call_skipped",
      severity: "watch",
      payload: {
        peerContactId: peer.id,
        peerName: peer.name,
        reason: "no_phone",
        conflictRiskId: next.conflictRiskId,
      },
    });
    await dispatchNextFromQueue(productionId);
    return;
  }

  // Look up the peer's own original call time on the same shoot day,
  // so the in-call agent can name BOTH times instead of saying "shift
  // your call to 7" without context.
  const [peerCallTime] = await db
    .select()
    .from(callTimes)
    .where(
      and(
        eq(callTimes.contactId, peer.id),
        eq(callTimes.shootDay, next.shootDay),
        eq(callTimes.productionId, productionId),
      ),
    )
    .limit(1);

  const purpose = buildRenegotiationPurpose({
    conflictContactName: next.conflictContactName,
    conflictContactRole: next.conflictContactRole,
    origCallAtISO: next.origCallAtISO,
    proposedCallAtISO: next.proposedCallAtISO,
    proposedReason: next.proposedReason,
    peerOrigCallAt: peerCallTime?.callAt ?? null,
    peerName: peer.name,
    peerRole: peer.role,
    shootDay: next.shootDay,
  });

  try {
    const placed = await placeCall({
      toNumber: peer.phone,
      productionId,
      contactId: peer.id,
      playbook: PLAYBOOK_TAG,
      purpose,
    });
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.call_placed",
      severity: "info",
      payload: {
        peerContactId: peer.id,
        peerName: peer.name,
        agentphoneCallId: placed.id,
        dbCallId: placed.dbCallId,
        conflictRiskId: next.conflictRiskId,
      },
    });
    console.log(
      `[change-of-plans] placed renegotiation call to ${peer.name} (${peer.id}); ${q.length} peers remaining in queue`,
    );
  } catch (err) {
    console.error(
      `[change-of-plans] placeCall failed for ${peer.name}:`,
      err,
    );
    await recordEvent({
      productionId,
      kind: "playbook.change_of_plans.call_failed",
      severity: "watch",
      payload: {
        peerContactId: peer.id,
        peerName: peer.name,
        error: (err as Error).message,
        conflictRiskId: next.conflictRiskId,
      },
    });
    // Skip this peer and continue with the queue — one rejection
    // shouldn't strand the rest. (E.g. AgentPhone 409 because the
    // contact's number happens to have an active call.)
    await dispatchNextFromQueue(productionId);
  }
}

/* ──────────────────────────────────────────────────────────────────── */
/* Scene-mate lookup                                                     */
/* ──────────────────────────────────────────────────────────────────── */

async function findSceneMates(
  productionId: string,
  conflictContactId: string,
  shootDay: number,
): Promise<Array<{ id: string; name: string; phone: string | null }>> {
  // Step 1: which scenes is the conflict contact in, on this shoot day?
  const sceneRows = await db
    .select({ sceneId: sceneCast.sceneId })
    .from(sceneCast)
    .innerJoin(scenes, eq(scenes.id, sceneCast.sceneId))
    .where(
      and(
        eq(sceneCast.contactId, conflictContactId),
        eq(scenes.productionId, productionId),
        eq(scenes.shootDay, shootDay),
      ),
    );
  if (sceneRows.length === 0) return [];

  const sceneIds = sceneRows.map((r) => r.sceneId);

  // Step 2: every OTHER contact in those scenes.
  const peerRows = await db
    .selectDistinct({ contactId: sceneCast.contactId })
    .from(sceneCast)
    .where(
      and(
        inArray(sceneCast.sceneId, sceneIds),
        ne(sceneCast.contactId, conflictContactId),
      ),
    );
  if (peerRows.length === 0) return [];

  const peerIds = peerRows.map((r) => r.contactId);

  // Hydrate the peer rows. We only return id/name/phone — anything
  // else we need we look up at dispatch time.
  return await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(inArray(contacts.id, peerIds));
}

/* ──────────────────────────────────────────────────────────────────── */
/* Email composition                                                     */
/* ──────────────────────────────────────────────────────────────────── */

interface EmailArgs {
  productionId: string;
  productionName: string;
  productionInbox: string;
  lineProducerEmail: string;
  lineProducerContactId: string;
  conflictContact: { id: string; name: string; role: string };
  origCallAt: Date | null;
  shootDay: number | null;
  proposedCallAtISO: string | null;
  proposedReason: string | null;
  description: string;
  riskId: string;
}

async function emailLineProducer(args: EmailArgs): Promise<void> {
  const origStr = args.origCallAt ? formatTime(args.origCallAt) : "their next call";
  const proposedStr = args.proposedCallAtISO
    ? formatTime(new Date(args.proposedCallAtISO))
    : "not specified";
  const shootDayStr = args.shootDay ? `shoot day ${args.shootDay}` : "next shoot day";
  const reasonStr = args.proposedReason ?? "not given";

  const subject = `[1AD] ${args.conflictContact.name} flagged a conflict on ${origStr} (${shootDayStr})`;

  const text = [
    `Heads up from One A.D. —`,
    ``,
    `${args.conflictContact.name} (${humanizeRole(args.conflictContact.role)}) on "${args.productionName}" raised a conflict on their scheduled call time during a 1AD agent call.`,
    ``,
    `  Production    : ${args.productionName}`,
    `  Contact       : ${args.conflictContact.name} (${humanizeRole(args.conflictContact.role)})`,
    `  Shoot day     : ${shootDayStr}`,
    `  Original call : ${origStr}`,
    `  Proposed alt  : ${proposedStr}`,
    `  Reason        : ${reasonStr}`,
    ``,
    `Contact's own words: "${args.description}"`,
    ``,
    args.proposedCallAtISO
      ? `Auto-action: One A.D. is placing renegotiation calls to everyone else in their scenes on the same shoot day to check whether the shift to ${proposedStr} works for them too. You'll see the results land in the 1AD dashboard as each call completes; this email is the heads-up so you know what's happening.`
      : `Auto-action: none — no alternative time was offered, so we can't renegotiate the scene-mates automatically. Recommend reaching out directly to confirm a new time.`,
    ``,
    `Risk id: ${args.riskId}`,
    ``,
    `— 1AD`,
  ].join("\n");

  let sent;
  try {
    sent = await sendEmail({
      to: args.lineProducerEmail,
      subject,
      text,
    });
  } catch (err) {
    console.error(`[change-of-plans] sendEmail failed:`, err);
    await recordEvent({
      productionId: args.productionId,
      kind: "email.send_failed",
      severity: "watch",
      payload: {
        toAddr: args.lineProducerEmail,
        subject,
        error: (err as Error).message,
        source: "change_of_plans",
        riskId: args.riskId,
      },
    });
    return;
  }

  await db.insert(emails).values({
    productionId: args.productionId,
    agentmailMessageId: sent.messageId ?? `unknown-${Date.now()}`,
    direction: "outbound",
    subject,
    body: text,
    toAddr: args.lineProducerEmail,
    fromAddr: args.productionInbox,
    sentAt: new Date(),
  });

  await recordEvent({
    productionId: args.productionId,
    kind: "email.sent",
    severity: "info",
    payload: {
      agentmailMessageId: sent.messageId,
      toAddr: args.lineProducerEmail,
      subject,
      lineProducerContactId: args.lineProducerContactId,
      conflictContactId: args.conflictContact.id,
      riskId: args.riskId,
      source: "change_of_plans",
    },
  });
}

/* ──────────────────────────────────────────────────────────────────── */
/* Purpose composition for renegotiation calls                          */
/* ──────────────────────────────────────────────────────────────────── */

interface PurposeArgs {
  conflictContactName: string;
  conflictContactRole: string;
  origCallAtISO: string;
  proposedCallAtISO: string;
  proposedReason: string | null;
  peerOrigCallAt: Date | null;
  peerName: string;
  peerRole: string;
  shootDay: number;
}

function buildRenegotiationPurpose(args: PurposeArgs): string {
  const origStr = formatTime(new Date(args.origCallAtISO));
  const proposedStr = formatTime(new Date(args.proposedCallAtISO));
  const peerOrigStr = args.peerOrigCallAt
    ? formatTime(args.peerOrigCallAt)
    : "their current call time";
  const reasonClause = args.proposedReason
    ? ` (reason: ${args.proposedReason})`
    : "";

  return [
    `${args.conflictContactName} (${humanizeRole(args.conflictContactRole)}) flagged that they can't make their ${origStr} call on shoot day ${args.shootDay} and proposed shifting to ${proposedStr}${reasonClause}.`,
    `You're calling ${args.peerName} (${humanizeRole(args.peerRole)}), who shares scenes with ${args.conflictContactName} on shoot day ${args.shootDay} and is currently scheduled for ${peerOrigStr}.`,
    `Your goal on THIS call: ask whether ${args.peerName} can accommodate a shift to ${proposedStr}. If yes, call record_confirmation. If no, ask what time would work and use record_conflict with proposedCallAt set.`,
    `IMPORTANT: do NOT confirm their existing ${peerOrigStr} call — the time is potentially changing. Frame the entire conversation around the proposed ${proposedStr} time.`,
    `Make clear that the new time is not yet approved — the line producer will reconcile everyone's responses afterwards. Do NOT promise the shift will happen.`,
  ].join(" ");
}

/* ──────────────────────────────────────────────────────────────────── */
/* Helpers                                                               */
/* ──────────────────────────────────────────────────────────────────── */

function formatTime(d: Date): string {
  // Render as "5:30 AM (Mon May 18)" in the production's local tz —
  // we don't track timezone on productions yet, so we lean on the
  // server's. Day-of-week + date helps the line producer eyeball
  // which day the conflict refers to without opening a calendar.
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  return `${time} (${day})`;
}

function humanizeRole(role: string): string {
  return role.replace(/_/g, " ");
}
