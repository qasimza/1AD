/**
 * AgentPhone webhook receiver.
 *
 * AgentPhone delivers two kinds of events here for an agent in webhook
 * (custom-LLM) mode:
 *
 *   1. `agent.message`  (channel="voice") — a fresh user transcript turn
 *      mid-call. We MUST respond with `application/x-ndjson` whose body is
 *      one-or-more JSON objects (one per line). The first chunk starts TTS;
 *      additional chunks (marked `interim: true`) stream while we keep
 *      working. The final chunk (no `interim` flag) closes the turn.
 *
 *   2. `agent.call_ended` (channel="voice") — fire-and-forget post-call
 *      summary. Return 200; AgentPhone ignores any body.
 *
 * SMS / iMessage / reaction events arrive on the same endpoint with
 * different `channel` / `event` values; they're acknowledged here but not
 * acted on until later chunks.
 *
 * Chunk 3 scope: prove the loop is alive by echoing transcripts.
 * Chunk 4 scope: persist call lifecycle (calls row + dashboard events).
 * Chunks 5+6 (collapsed): route every voice turn through the OpenAI
 *   Agents SDK with real function tools (`get_call_time`,
 *   `get_scene_details`, `record_confirmation`, `record_conflict`,
 *   `end_call`). We send an immediate interim NDJSON chunk so the caller
 *   hears a backchannel while the agent loop runs, then the final chunk
 *   with the model's reply. If the agent invoked `end_call`, we
 *   fire-and-forget a REST hang-up after the spoken goodbye.
 *
 * Security: every delivery carries `X-Webhook-Signature` (HMAC-SHA256 over
 * `${timestamp}.${rawBody}`) and `X-Webhook-Timestamp`. We verify and log;
 * we do NOT reject — the secret rotates on every webhook upsert and we
 * never want to lock a live call out mid-test. Tighten in chunk 9+.
 *
 * Docs: https://docs.agentphone.ai/documentation/guides/webhooks
 */
import type { NextRequest } from "next/server";

import { runOneAD } from "@/lib/agent/one-ad";
import {
  getCallContext,
  recordCallEnded,
  type TranscriptTurn,
} from "@/lib/voice/calls";
import { recordEvent } from "@/lib/orchestrator/events";
import { verifyAgentPhoneSignature } from "@/lib/voice/signature";
import { sendPostCallSummary } from "@/lib/voice/summary";

// Voice webhooks must respond well under AgentPhone's 30s default timeout.
// Force a Node runtime so we can read raw text + stream NDJSON without
// edge-runtime quirks around ReadableStream encoding.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Module-level conversation continuity keyed by AgentPhone callId.
 *
 * Each entry is the most recent `lastResponseId` from the Agents SDK
 * run on that call. Passing it back as `previousResponseId` on the next
 * turn lets the Responses API continue from server-managed state,
 * which means:
 *   - we DON'T send full chat history every turn (cheaper + faster),
 *   - the model can't drift away from what we think it said,
 *   - "the agent re-introduces itself every turn" (chunk-5 symptom)
 *     is structurally impossible.
 *
 * Trade-off: lost on Next.js hot reload + doesn't span horizontal
 * instances. Both acceptable for day 2 — dev hot reload only affects
 * local testing, and we're single-instance for the foreseeable
 * future. Migrate to Postgres-backed state on day 3+.
 */
const lastResponseIds = new Map<string, string>();

/** Hardcoded purpose for chunks 5/6. Chunk 7 will derive this per call. */
const PLACEHOLDER_PURPOSE =
  "Confirm the recipient is good for their next call time, surface any conflicts or transportation needs, and wrap the call cleanly once you have an answer.";

/**
 * The line One A.D. speaks when WE — not the user — have to end the
 * call due to a system failure (DB down, OpenAI 500, etc.). We say it,
 * then signal AgentPhone to drop the line, so the user isn't left
 * hanging in awkward silence.
 */
const SYSTEM_FAILURE_REPLY =
  "Sorry — I'm experiencing some issues on my end. I'll give you a call back later. Thanks for picking up.";

/**
 * Regex matching common farewell phrases. The agent's prompt tells it
 * to invoke `end_call` whenever its reply contains a farewell, but
 * models slip — they say "bye" in one turn and call `end_call` only on
 * the next, leaving the line open for an awkward extra beat. This
 * regex is a safety net: if the spoken reply ends with a farewell and
 * the model forgot to call end_call, we still emit `hangup: true`.
 *
 * Keep the patterns tight (word boundaries, anchored to the last ~30
 * chars of the reply) so we don't false-positive on mid-sentence uses
 * like "I'll call back later".
 */
const FAREWELL_REGEX =
  /\b(bye|goodbye|see you|talk soon|have a good (one|day|night)|take care|we're (done|good) here|that(?:'s| is) all (I need|I have))\b[.!?…\s]*$/i;

interface VoiceMessageData {
  callId: string;
  numberId: string;
  from: string;
  to: string;
  status: string;
  transcript: string;
  confidence?: number;
  direction: "inbound" | "outbound";
}

interface CallEndedData {
  callId: string;
  numberId: string;
  from: string;
  to: string;
  direction: "inbound" | "outbound";
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
  disconnectionReason?: string;
  transcript?: Array<{ role: "agent" | "user"; content: string }>;
  summary?: string;
  userSentiment?: string;
  callSuccessful?: boolean;
}

interface HistoryItem {
  content: string;
  direction: "inbound" | "outbound";
  channel: string;
  at: string;
}

interface WebhookEnvelope {
  event: string;
  channel: string;
  timestamp: string;
  agentId: string;
  data: unknown;
  conversationState?: unknown;
  recentHistory?: HistoryItem[];
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  let payload: WebhookEnvelope;
  try {
    payload = JSON.parse(rawBody) as WebhookEnvelope;
  } catch {
    console.warn("[agentphone-hook] non-JSON body, returning 400");
    return new Response("invalid JSON", { status: 400 });
  }

  const deliveryId = req.headers.get("x-webhook-id") ?? "(none)";
  const sigHeader = req.headers.get("x-webhook-signature");
  const tsHeader = req.headers.get("x-webhook-timestamp");

  // Verify signature when we have a secret. Log on mismatch but never
  // reject — the secret rotates on every webhook upsert and we don't
  // want to lock a live call mid-test.
  const secret = process.env.AGENTPHONE_WEBHOOK_SECRET;
  let sigStatus: "ok" | "mismatch" | "missing-secret" | "missing-headers";
  if (!secret) {
    sigStatus = "missing-secret";
  } else if (!sigHeader || !tsHeader) {
    sigStatus = "missing-headers";
  } else {
    const v = verifyAgentPhoneSignature({
      rawBody,
      signatureHeader: sigHeader,
      timestampHeader: tsHeader,
      secret,
    });
    sigStatus = v.ok ? "ok" : "mismatch";
    if (!v.ok) {
      console.warn(
        `[agentphone-hook] signature ${v.reason} (delivery ${deliveryId})`,
      );
    }
  }

  console.log("[agentphone-hook] ←", {
    deliveryId,
    sigStatus,
    event: payload.event,
    channel: payload.channel,
    agentId: payload.agentId,
  });

  if (payload.event === "agent.call_ended" && payload.channel === "voice") {
    const data = payload.data as CallEndedData;
    console.log("[agentphone-hook] call_ended", {
      callId: data.callId,
      durationSeconds: data.durationSeconds,
      disconnectionReason: data.disconnectionReason,
      summary: data.summary,
      turns: data.transcript?.length ?? 0,
    });

    // Free conversation continuity for this call so the Map doesn't
    // grow forever. Idempotent on retry.
    lastResponseIds.delete(data.callId);

    try {
      const result = await recordCallEnded({
        agentphoneCallId: data.callId,
        endedAt: data.endedAt ? new Date(data.endedAt) : new Date(),
        status: data.status,
        disconnectionReason: data.disconnectionReason,
        transcript: data.transcript as TranscriptTurn[] | undefined,
        durationSeconds: data.durationSeconds,
      });
      if (!result.found) {
        console.warn(
          `[agentphone-hook] call_ended for unknown agentphoneCallId ${data.callId} — no DB row updated`,
        );
      } else {
        console.log(
          `[agentphone-hook] persisted call ${result.callId} outcome=${result.outcome}`,
        );

        // Fire-and-forget the post-call SMS recap. The summariser
        // inspects outcome + transcript + contact phone and silently
        // skips when the call didn't produce anything worth texting
        // (voicemail, no-answer, no transcript, no phone). Any failure
        // is swallowed inside `sendPostCallSummary` so it can never
        // bring the webhook ack down.
        void sendPostCallSummary(result.callId!).catch((err) =>
          console.error(
            "[agentphone-hook] sendPostCallSummary unexpected reject:",
            err,
          ),
        );
      }
    } catch (err) {
      // Never fail the webhook response on a DB hiccup — AgentPhone will
      // retry with exponential backoff, which is worse than logging here.
      console.error("[agentphone-hook] failed to persist call_ended:", err);
    }

    return new Response("ok", { status: 200 });
  }

  if (payload.event !== "agent.message" || payload.channel !== "voice") {
    console.log(
      `[agentphone-hook] ignoring ${payload.event}/${payload.channel}`,
    );
    return new Response("ok", { status: 200 });
  }

  const data = payload.data as VoiceMessageData;
  console.log("[agentphone-hook] voice turn", {
    callId: data.callId,
    from: data.from,
    transcript: data.transcript,
    confidence: data.confidence,
  });

  const userTurn = data.transcript ?? "";
  const previousResponseId = lastResponseIds.get(data.callId);

  console.log(
    `[agentphone-hook] continuity: previousResponseId=${previousResponseId ? previousResponseId.slice(-8) : "(none)"}`,
  );

  // NDJSON streaming response. We deliberately do NOT emit an interim
  // backchannel chunk anymore: the chunk-5 "Mm-hmm. / Got it." filler
  // fired on EVERY user turn — even one-word utterances — and made the
  // agent sound like an over-eager chatbot. With the Agents SDK loop
  // landing replies in ~1-2s, a brief beat of silence is more natural
  // than a reflexive ack. The model itself decides when an
  // acknowledgement is warranted.
  //
  // Order of operations inside `start`:
  //   1. Look up call context (production + contact) for instructions.
  //   2. Fire-and-forget `call.turn` event for the dashboard feed.
  //   3. Await the agent run (LLM + tool loop).
  //   4. Stash `lastResponseId` for the next turn's continuity.
  //   5. Flush the final chunk; if `end_call` was invoked, schedule a
  //      REST hang-up after the spoken sentence.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();

      // Three things can go wrong on the way to a reply:
      //   - `getCallContext` throws (DB unreachable / query error).
      //   - `runOneAD` throws (OpenAI 5xx, network, SDK exception).
      //   - `runOneAD` returns an empty reply.
      // For ANY of those, we speak the system-failure line, persist the
      // call as ended-due-to-failure, and trigger the REST hang-up so
      // the user isn't sitting in awkward silence waiting for us.
      let systemFailure = false;

      let context = null;
      try {
        context = await getCallContext(data.callId);
      } catch (err) {
        console.error(
          "[agentphone-hook] getCallContext failed — graceful hang-up:",
          err,
        );
        systemFailure = true;
      }

      if (context) {
        recordEvent({
          productionId: context.productionId,
          kind: "call.turn",
          severity: "info",
          payload: {
            callId: context.callId,
            agentphoneCallId: data.callId,
            contactId: context.contactId,
            transcript: userTurn,
            confidence: data.confidence,
          },
        }).catch((err) =>
          console.error(
            "[agentphone-hook] failed to emit call.turn event:",
            err,
          ),
        );
      } else {
        console.warn(
          `[agentphone-hook] voice turn for unknown agentphoneCallId ${data.callId} — agent will run with generic prompt`,
        );
      }

      let reply = SYSTEM_FAILURE_REPLY;
      let hangup: { reason: string } | undefined;

      if (!systemFailure) {
        try {
          const result = await runOneAD({
            context: {
              callDbId: context?.callId ?? "",
              agentphoneCallId: data.callId,
              productionId: context?.productionId ?? "",
              contactId: context?.contactId ?? "",
            },
            userTurn,
            previousResponseId,
            callInfo: context
              ? {
                  productionName: context.productionName,
                  contactName: context.contactName,
                  contactRole: context.contactRole,
                  purpose: PLACEHOLDER_PURPOSE,
                }
              : null,
          });

          if (result.reply && result.reply.trim().length > 0) {
            reply = result.reply;
            hangup = result.hangupRequested;
            if (result.lastResponseId) {
              lastResponseIds.set(data.callId, result.lastResponseId);
            }
            console.log(
              `[agentphone-hook] agent ok in ${result.latencyMs}ms tools=[${result.toolCalls
                .map((t) => t.name)
                .join(", ")}] reply="${reply.slice(0, 120)}"${hangup ? ` hangup=${hangup.reason}` : ""}`,
            );

            // Surface tool calls as dashboard events. Fire-and-forget.
            if (context) {
              for (const tc of result.toolCalls) {
                recordEvent({
                  productionId: context.productionId,
                  kind: "agent.tool",
                  severity: "info",
                  payload: {
                    callId: context.callId,
                    tool: tc.name,
                    ok: tc.ok,
                  },
                }).catch(() => {});
              }
            }
          } else {
            console.warn(
              "[agentphone-hook] agent returned empty reply — graceful hang-up",
            );
            systemFailure = true;
          }
        } catch (err) {
          console.error(
            "[agentphone-hook] agent run failed — graceful hang-up:",
            err,
          );
          systemFailure = true;
        }
      }

      // A system failure always hangs up after the apology — leaving the
      // caller on the line waiting for a recovery turn would be worse
      // than ending the call. We also emit a `call.system_failure` event
      // so the dashboard surfaces this differently from a goal-achieved
      // hang-up.
      if (systemFailure) {
        reply = SYSTEM_FAILURE_REPLY;
        hangup = { reason: "system_failure" };
        if (context) {
          recordEvent({
            productionId: context.productionId,
            kind: "call.system_failure",
            severity: "live",
            payload: {
              callId: context.callId,
              agentphoneCallId: data.callId,
            },
          }).catch(() => {});
        }
      }

      // Safety net: if the reply ends with a farewell phrase but the
      // model forgot to invoke `end_call`, treat that as an implicit
      // hangup. This was the #1 reason calls dragged on for an extra
      // turn — the model would say "bye" but only call end_call on the
      // next webhook delivery.
      if (!hangup && FAREWELL_REGEX.test(reply)) {
        console.log(
          "[agentphone-hook] inferred hangup from farewell phrase in reply",
        );
        hangup = { reason: "inferred_farewell" };
      }

      // Include `hangup: true` directly in the final NDJSON chunk.
      // AgentPhone handles the timing: TTS speaks the text first, then
      // drops the line. Docs:
      // https://docs.agentphone.ai/documentation/guides/calls
      //   field `hangup` on the webhook response, "Set to true to end
      //   the call after speaking".
      const finalChunk: Record<string, unknown> = { text: reply };
      if (hangup) finalChunk.hangup = true;
      controller.enqueue(enc.encode(JSON.stringify(finalChunk) + "\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

// Convenience GET so you can curl the URL after `ngrok http 3000` and
// confirm the route is registered before placing a real call.
export async function GET() {
  return Response.json({
    ok: true,
    route: "/api/hook/agentphone",
    note: "POST your AgentPhone webhook deliveries here.",
  });
}
