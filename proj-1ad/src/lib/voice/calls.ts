/**
 * Single-writer for the `calls` table.
 *
 * Per TDD §2.3, only the orchestrator writes to Postgres. Every code path
 * that wants to create/update a call row must come through this module so
 * we have one place to enforce shape, derive the outcome string, and emit
 * the matching `events` row for the dashboard feed.
 *
 * Call lifecycle (chunk 4 scope):
 *   1. `recordOutboundPlaced` — write the initial row right after the
 *      AgentPhone API accepts our /v1/calls request. `startedAt = now()`
 *      because AgentPhone has queued the dial; `endedAt` and `outcome`
 *      stay NULL until call_ended fires.
 *   2. `recordCallEnded` — patch the row when AgentPhone fires
 *      `agent.call_ended`: endedAt, transcript (stringified JSON), and
 *      a derived outcome string.
 *
 * What we deliberately don't do yet:
 *   - `structuredResult` (chunk 6, via Gemini tool calls)
 *   - `playbook` column (chunk 9, set by playbook dispatcher)
 *   - reconciliation for dropped webhook deliveries (lives in
 *     /api/tick later — see TDD §risks "AgentPhone webhook drops a
 *     call.ended")
 */
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calls, contacts, productions } from "@/db/schema";
import { recordEvent } from "@/lib/orchestrator/events";

export type CallOutcome =
  | "completed"
  | "voicemail"
  | "no_answer"
  | "busy"
  | "failed"
  | "hangup";

export interface TranscriptTurn {
  role: "agent" | "user";
  content: string;
}

export interface RecordOutboundPlacedArgs {
  productionId: string;
  contactId: string;
  agentphoneCallId: string;
}

/**
 * Map AgentPhone's call-ended payload onto our outcome enum. AgentPhone's
 * `disconnectionReason` values aren't fully enumerated in the public docs,
 * so this is intentionally tolerant: any unknown reason on a successful
 * call falls back to 'completed'; anything on a non-completed call falls
 * back to 'failed'. Tighten as we observe real values in production.
 */
export function deriveOutcome(
  status: string | undefined,
  disconnectionReason: string | undefined,
): CallOutcome {
  if (status && status !== "completed") return "failed";
  const r = (disconnectionReason ?? "").toLowerCase();
  if (!r) return "completed";
  if (r.includes("voicemail")) return "voicemail";
  if (r.includes("no_answer") || r.includes("no-answer")) return "no_answer";
  if (r === "busy" || r.includes("busy")) return "busy";
  if (r.includes("hangup")) return "hangup";
  if (r.includes("error") || r.includes("fail")) return "failed";
  return "completed";
}

/**
 * Insert the initial row for an outbound call we just placed. Returns the
 * new uuid so the caller can correlate (e.g. attach to a playbook run id).
 *
 * Emits `events.kind='call.placed'` at severity 'info' for the dashboard
 * feed.
 */
export async function recordOutboundPlaced(
  args: RecordOutboundPlacedArgs,
): Promise<string> {
  const [row] = await db
    .insert(calls)
    .values({
      productionId: args.productionId,
      contactId: args.contactId,
      direction: "outbound",
      agentphoneCallId: args.agentphoneCallId,
      startedAt: new Date(),
    })
    .returning({ id: calls.id });

  await recordEvent({
    productionId: args.productionId,
    kind: "call.placed",
    severity: "info",
    payload: {
      callId: row.id,
      agentphoneCallId: args.agentphoneCallId,
      contactId: args.contactId,
      direction: "outbound",
    },
  });

  return row.id;
}

export interface RecordCallEndedArgs {
  agentphoneCallId: string;
  endedAt: Date;
  status?: string;
  disconnectionReason?: string;
  transcript?: TranscriptTurn[];
  durationSeconds?: number;
}

export interface CallEndedResult {
  found: boolean;
  callId?: string;
  productionId?: string;
  outcome: CallOutcome;
}

/**
 * Update an existing row when AgentPhone reports `agent.call_ended`. If
 * we never recorded the placed call (e.g. a stray inbound delivery to a
 * number we own, or a hosted-mode call that bypassed placeCall's DB
 * insert), `found=false` and the caller decides whether to skip the
 * event or insert a stub row.
 *
 * The transcript is stored as stringified JSON of the {role, content}
 * array — per chunk 4 design, structure is preserved losslessly and the
 * UI/Gemini context builder parses on read.
 */
export async function recordCallEnded(
  args: RecordCallEndedArgs,
): Promise<CallEndedResult> {
  const outcome = deriveOutcome(args.status, args.disconnectionReason);
  const transcriptJson = args.transcript
    ? JSON.stringify(args.transcript)
    : null;

  const updated = await db
    .update(calls)
    .set({
      endedAt: args.endedAt,
      outcome,
      transcript: transcriptJson,
    })
    .where(eq(calls.agentphoneCallId, args.agentphoneCallId))
    .returning({ id: calls.id, productionId: calls.productionId });

  if (updated.length === 0) {
    return { found: false, outcome };
  }

  const row = updated[0];
  await recordEvent({
    productionId: row.productionId,
    kind: "call.completed",
    severity: "info",
    payload: {
      callId: row.id,
      agentphoneCallId: args.agentphoneCallId,
      outcome,
      durationSeconds: args.durationSeconds,
      disconnectionReason: args.disconnectionReason,
      turns: args.transcript?.length ?? 0,
    },
  });

  return {
    found: true,
    callId: row.id,
    productionId: row.productionId,
    outcome,
  };
}

/**
 * Cheap lookup used by the webhook receiver on every `agent.message`
 * turn to attach the right `productionId` (events.productionId is NOT
 * NULL) when emitting `call.turn` events. Returns the production id and
 * row id, or null if we have no record of this AgentPhone call.
 */
export async function findCallByAgentphoneId(
  agentphoneCallId: string,
): Promise<
  | { id: string; productionId: string; contactId: string | null }
  | null
> {
  const [row] = await db
    .select({
      id: calls.id,
      productionId: calls.productionId,
      contactId: calls.contactId,
    })
    .from(calls)
    .where(eq(calls.agentphoneCallId, agentphoneCallId))
    .limit(1);

  return row ?? null;
}

export interface CallContext {
  callId: string;
  productionId: string;
  productionName: string;
  contactId: string | null;
  contactName: string | null;
  contactRole: string | null;
}

/**
 * One-shot lookup that hydrates everything the LLM layer needs to build
 * a system prompt: production name, contact name/role, plus the call's
 * own ids. Single query (calls ⋈ productions ⋈ contacts) so we pay one
 * round trip per voice turn rather than three.
 *
 * Returns null when the agentphoneCallId is unknown — the webhook then
 * uses the generic system prompt rather than failing the turn.
 */
export async function getCallContext(
  agentphoneCallId: string,
): Promise<CallContext | null> {
  const [row] = await db
    .select({
      callId: calls.id,
      productionId: calls.productionId,
      productionName: productions.name,
      contactId: calls.contactId,
      contactName: contacts.name,
      contactRole: contacts.role,
    })
    .from(calls)
    .innerJoin(productions, eq(productions.id, calls.productionId))
    .leftJoin(contacts, eq(contacts.id, calls.contactId))
    .where(eq(calls.agentphoneCallId, agentphoneCallId))
    .limit(1);

  if (!row) return null;
  return {
    callId: row.callId,
    productionId: row.productionId,
    productionName: row.productionName,
    contactId: row.contactId,
    contactName: row.contactName,
    contactRole: row.contactRole,
  };
}
