/**
 * Function tools for the One A.D. agent.
 *
 * Every tool here is a real-data tool: it reads from or writes to
 * Postgres so the model has ground truth rather than vibes. The agent
 * autonomously decides when to call them — that's the "agent loop" we
 * lost in the chunk-5 hand-rolled chat wrapper.
 *
 * Tools share an `AgentContext` (see `one-ad.ts`) carrying the current
 * call's ids. Side effects flow back to the webhook handler via mutable
 * fields on that context (e.g. `hangupRequested`).
 *
 * Patterns we follow:
 *   - Tools return small structured objects, never giant blobs.
 *   - Errors are caught and returned as `{ ok: false, error: ... }`
 *     rather than thrown — the model handles graceful degradation
 *     better than the SDK's default error wrapper.
 *   - Writes also `recordEvent(...)` so the dashboard live feed sees
 *     them in real time.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";

import { db } from "@/db/client";
import {
  callTimes,
  locations,
  risks,
  sceneCast,
  scenes,
} from "@/db/schema";
import { recordEvent } from "@/lib/orchestrator/events";

export interface AgentContext {
  /** Foreign key into the `calls` table (uuid). */
  callDbId: string;
  /** AgentPhone's own call id (string). Used for cross-system correlation. */
  agentphoneCallId: string;
  productionId: string;
  contactId: string;
  /**
   * Set by `end_call` tool when the model decides the call is done.
   * The webhook reads this AFTER `run()` returns and includes
   * `hangup: true` in the NDJSON response.
   */
  hangupRequested?: { reason: string };
}

/**
 * Unwrap the SDK's `RunContext<AgentContext>` to get the bare context
 * object we passed into `run({ context })`.
 *
 * This MATTERS: the SDK's tool `execute(args, context)` second arg is
 * `RunContext<T>`, NOT `T`. Naively casting it to `AgentContext` means
 * every `ctx.contactId` / `ctx.productionId` is `undefined`, and every
 * mutation (e.g. setting `ctx.hangupRequested`) writes to the wrapper
 * instead of the underlying object the webhook reads after `run()`.
 *
 * Symptoms of getting this wrong: `get_call_time` returns null even
 * with seeded data, `record_confirmation` updates no rows, and
 * `end_call` never propagates the hangup flag back to the webhook.
 */
function unwrap(rc: unknown): AgentContext {
  return (rc as RunContext<AgentContext>).context;
}

/* ──────────────────────────────────────────────────────────────────── */
/* Read tools                                                            */
/* ──────────────────────────────────────────────────────────────────── */

export const getCallTime = tool({
  name: "get_call_time",
  description:
    "Look up the contact's next scheduled call time on this production. Returns the call time, shoot day, freshness signal, and whether it has already been confirmed. Returns null when the contact has no upcoming call time recorded.",
  parameters: z.object({}),
  async execute(_args, context) {
    const ctx = unwrap(context);
    const [row] = await db
      .select({
        id: callTimes.id,
        shootDay: callTimes.shootDay,
        callAt: callTimes.callAt,
        freshness: callTimes.freshness,
        confirmedAt: callTimes.confirmedAt,
      })
      .from(callTimes)
      .where(
        and(
          eq(callTimes.contactId, ctx.contactId),
          gt(callTimes.callAt, new Date()),
        ),
      )
      .orderBy(asc(callTimes.callAt))
      .limit(1);

    if (!row) return null;
    return {
      callTimeId: row.id,
      shootDay: row.shootDay,
      callAt: row.callAt.toISOString(),
      callAtPretty: row.callAt.toLocaleString("en-US", {
        weekday: "long",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }),
      freshness: row.freshness,
      alreadyConfirmed: row.confirmedAt != null,
    };
  },
});

export const getSceneDetails = tool({
  name: "get_scene_details",
  description:
    "Return scenes the contact is scheduled to be in on their next shoot day, with location name, planned start/end, and estimated setup. Use this to give the contact specific information about what they're shooting.",
  parameters: z.object({}),
  async execute(_args, context) {
    const ctx = unwrap(context);

    const [nextCallRow] = await db
      .select({ shootDay: callTimes.shootDay })
      .from(callTimes)
      .where(
        and(
          eq(callTimes.contactId, ctx.contactId),
          gt(callTimes.callAt, new Date()),
        ),
      )
      .orderBy(asc(callTimes.callAt))
      .limit(1);

    if (!nextCallRow) {
      return { shootDay: null, scenes: [] as Array<unknown> };
    }

    const sceneIds = await db
      .select({ sceneId: sceneCast.sceneId })
      .from(sceneCast)
      .where(eq(sceneCast.contactId, ctx.contactId));

    if (sceneIds.length === 0) {
      return { shootDay: nextCallRow.shootDay, scenes: [] };
    }

    const rows = await db
      .select({
        sceneNumber: scenes.sceneNumber,
        description: scenes.description,
        type: scenes.type,
        plannedStart: scenes.plannedStart,
        plannedEnd: scenes.plannedEnd,
        estimatedSetupMinutes: scenes.estimatedSetupMinutes,
        status: scenes.status,
        locationName: locations.name,
        locationAddress: locations.address,
      })
      .from(scenes)
      .leftJoin(locations, eq(locations.id, scenes.locationId))
      .where(
        and(
          eq(scenes.shootDay, nextCallRow.shootDay),
          eq(scenes.productionId, ctx.productionId),
          inArray(
            scenes.id,
            sceneIds.map((s) => s.sceneId),
          ),
        ),
      )
      .orderBy(asc(scenes.orderWithinDay));

    return {
      shootDay: nextCallRow.shootDay,
      scenes: rows.map((s) => ({
        sceneNumber: s.sceneNumber,
        description: s.description,
        type: s.type,
        plannedStart: s.plannedStart?.toISOString() ?? null,
        plannedEnd: s.plannedEnd?.toISOString() ?? null,
        estimatedSetupMinutes: s.estimatedSetupMinutes,
        status: s.status,
        location: s.locationName,
        locationAddress: s.locationAddress,
      })),
    };
  },
});

/* ──────────────────────────────────────────────────────────────────── */
/* Write tools                                                           */
/* ──────────────────────────────────────────────────────────────────── */

export const recordConfirmation = tool({
  name: "record_confirmation",
  description:
    "Record that the contact confirmed (or did NOT confirm) their next call time. Only call this AFTER you have actually asked and gotten a clear yes/no. Optional `notes` capture anything the contact said about transportation, conflicts, or preferences.",
  parameters: z.object({
    confirmed: z
      .boolean()
      .describe("True if the contact verbally confirmed the call time."),
    notes: z
      .string()
      .nullable()
      .describe(
        "Optional free-form notes from the contact (e.g. 'will be 5 min late', 'needs ride from base'). Pass null when no extra notes.",
      ),
  }),
  async execute(args, context) {
    const ctx = unwrap(context);
    try {
      const [target] = await db
        .select({ id: callTimes.id })
        .from(callTimes)
        .where(
          and(
            eq(callTimes.contactId, ctx.contactId),
            gt(callTimes.callAt, new Date()),
          ),
        )
        .orderBy(asc(callTimes.callAt))
        .limit(1);

      if (!target) {
        return {
          ok: false as const,
          error: "no upcoming call_time row found for this contact",
        };
      }

      await db
        .update(callTimes)
        .set({
          confirmedAt: args.confirmed ? new Date() : null,
          confirmationCallId: ctx.callDbId,
        })
        .where(eq(callTimes.id, target.id));

      await recordEvent({
        productionId: ctx.productionId,
        kind: args.confirmed ? "call.confirmed" : "call.unconfirmed",
        severity: "info",
        payload: {
          callId: ctx.callDbId,
          contactId: ctx.contactId,
          callTimeId: target.id,
          notes: args.notes ?? null,
        },
      });

      return { ok: true as const, confirmed: args.confirmed };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  },
});

export const recordConflict = tool({
  name: "record_conflict",
  description:
    "Flag a problem the contact raised on the call — typically that they can't make the scheduled call time, but also safety concerns, missing accommodations, or anything else that needs human follow-up. Use whichever fields you have information for; the optional ones let downstream playbooks (line producer SMS, schedule renegotiation) act on structured data instead of parsing prose.",
  parameters: z.object({
    description: z
      .string()
      .describe(
        "One-sentence description of the issue in the contact's own words where possible (e.g. 'Maya can't be there at 5:30, asked for 7am instead because of childcare').",
      ),
    severity: z
      .enum(["flag", "reschedule", "escalate"])
      .describe(
        "`flag` for an FYI, `reschedule` if the call time has to move, `escalate` if it needs the line producer right now.",
      ),
    proposedCallAt: z
      .string()
      .nullable()
      .describe(
        "If the contact volunteered an alternative call time, pass it as ISO-8601 with timezone (e.g. '2026-05-18T07:00:00-07:00'). Pass null when no alternative was offered. Do NOT invent a time the contact didn't actually say.",
      ),
    proposedReason: z
      .string()
      .nullable()
      .describe(
        "Short reason for the conflict if the contact gave one ('childcare', 'transit issue', 'medical', 'wardrobe conflict'). Pass null when unstated.",
      ),
  }),
  async execute(args, context) {
    const ctx = unwrap(context);
    try {
      const [row] = await db
        .insert(risks)
        .values({
          productionId: ctx.productionId,
          kind: "contact_conflict",
          severity: args.severity,
          context: {
            description: args.description,
            proposedCallAt: args.proposedCallAt ?? null,
            proposedReason: args.proposedReason ?? null,
            contactId: ctx.contactId,
            callDbId: ctx.callDbId,
            agentphoneCallId: ctx.agentphoneCallId,
          },
        })
        .returning({ id: risks.id });

      await recordEvent({
        productionId: ctx.productionId,
        kind: "risk.detected",
        severity: args.severity === "escalate" ? "live" : "watch",
        payload: {
          riskId: row.id,
          callId: ctx.callDbId,
          contactId: ctx.contactId,
          description: args.description,
          proposedCallAt: args.proposedCallAt ?? null,
          proposedReason: args.proposedReason ?? null,
          source: "in_call_agent",
        },
      });

      return {
        ok: true as const,
        riskId: row.id,
        nextStep:
          "The line producer will be notified and follow up with the contact. The agent should set this expectation before ending the call.",
      };
    } catch (err) {
      return { ok: false as const, error: (err as Error).message };
    }
  },
});

export const endCall = tool({
  name: "end_call",
  description:
    "Signal that this call should be ended after your next spoken sentence. Use when the stated purpose has been satisfied, the contact asked to hang up, or you genuinely cannot make further progress. Always say a brief goodbye in your final reply when calling this.",
  parameters: z.object({
    reason: z
      .enum(["goal_achieved", "callback_requested", "cannot_progress"])
      .describe("Why the call is ending."),
  }),
  async execute(args, context) {
    const ctx = unwrap(context);
    // Side-effect only: the webhook reads this after run() returns.
    // `unwrap` returns the SAME object we passed into `run({ context })`,
    // so mutating it here is visible to the webhook handler.
    ctx.hangupRequested = { reason: args.reason };
    return { acknowledged: true as const, reason: args.reason };
  },
});

/** All tools, in the order the model sees them. */
export const oneADTools = [
  getCallTime,
  getSceneDetails,
  recordConfirmation,
  recordConflict,
  endCall,
];
