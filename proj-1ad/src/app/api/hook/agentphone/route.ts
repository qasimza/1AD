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
 * Chunk 5 scope: route every voice turn through the LLM (default
 * OpenAI gpt-5.4-mini, configurable via LLM_MODEL env). We send an
 * immediate interim NDJSON chunk so the caller hears "one sec" while
 * the model thinks, then the final chunk with the model's reply.
 *
 * Security: every delivery carries `X-Webhook-Signature` (HMAC-SHA256 over
 * `${timestamp}.${rawBody}`) and `X-Webhook-Timestamp`. We verify and log;
 * we do NOT reject — the secret rotates on every webhook upsert and we
 * never want to lock a live call out mid-test. Tighten in chunk 9+.
 *
 * Docs: https://docs.agentphone.ai/documentation/guides/webhooks
 */
import type { NextRequest } from "next/server";

import { chat, type ChatMessage } from "@/lib/llm/chat";
import { pickInterim } from "@/lib/llm/interims";
import {
  baseCallSystemPrompt,
  genericCallSystemPrompt,
} from "@/lib/llm/prompts";
import { recordEvent } from "@/lib/orchestrator/events";
import {
  getCallContext,
  recordCallEnded,
  type TranscriptTurn,
} from "@/lib/voice/calls";
import { verifyAgentPhoneSignature } from "@/lib/voice/signature";

// Voice webhooks must respond well under AgentPhone's 30s default timeout.
// Force a Node runtime so we can read raw text + stream NDJSON without
// edge-runtime quirks around ReadableStream encoding.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Translate AgentPhone's recentHistory into chat turns.
 *
 * AgentPhone calls the user "inbound" (audio coming IN to the agent) and
 * the agent "outbound". OpenAI/Anthropic call user turns "user" and
 * agent turns "assistant".
 */
function toChatHistory(history: HistoryItem[] | undefined): ChatMessage[] {
  if (!history || history.length === 0) return [];
  return history
    .filter((h) => h.channel === "voice")
    .map<ChatMessage>((h) => ({
      role: h.direction === "outbound" ? "assistant" : "user",
      text: h.content,
    }));
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

  // Verify the signature when we have a secret to verify against. We log
  // mismatches loudly but never reject — the secret rotates on every
  // webhook upsert and we don't want to lock a live call mid-test.
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

  // Friendly base log every event shares — easy to grep in `next dev`.
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

    // Persist lifecycle close. `recordCallEnded` looks up the row by
    // agentphoneCallId — if it's missing (stray inbound call, hosted-mode
    // call that bypassed our insert), we just log and move on rather than
    // creating an orphaned record.
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
      }
    } catch (err) {
      // Never fail the webhook response on a DB hiccup — AgentPhone will
      // retry with exponential backoff (per webhooks doc), which is worse
      // than just logging here.
      console.error("[agentphone-hook] failed to persist call_ended:", err);
    }

    // `agent.call_ended` is fire-and-forget — body is ignored.
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
  const interim = pickInterim();
  const history = toChatHistory(payload.recentHistory);

  // NDJSON streaming response so the caller hears the interim chunk while
  // we're still calling the LLM. Order of operations inside `start`:
  //   1. Flush `{interim:true}` immediately — TTS starts speaking it.
  //   2. Look up call context (production + contact) for the system prompt.
  //   3. Fire-and-forget `call.turn` event for the dashboard.
  //   4. Await the LLM reply.
  //   5. Flush the final chunk and close the turn.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(JSON.stringify({ text: interim, interim: true }) + "\n"),
      );

      let context = null;
      try {
        context = await getCallContext(data.callId);
      } catch (err) {
        console.error("[agentphone-hook] getCallContext failed:", err);
      }

      if (context) {
        // Don't await — the dashboard feed can wait a tick, the caller can't.
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
          `[agentphone-hook] voice turn for unknown agentphoneCallId ${data.callId} — using generic prompt`,
        );
      }

      const system = context
        ? baseCallSystemPrompt({
            productionName: context.productionName,
            contactName: context.contactName ?? undefined,
            contactRole: context.contactRole ?? undefined,
          })
        : genericCallSystemPrompt();

      let reply: string;
      const t0 = Date.now();
      try {
        reply = await chat({ system, history, user: userTurn });
        console.log(
          `[agentphone-hook] llm ok in ${Date.now() - t0}ms: ${reply.slice(0, 120)}`,
        );
      } catch (err) {
        console.error("[agentphone-hook] llm failed:", err);
        // Better to say SOMETHING than to drop dead air on a live call.
        reply =
          "Sorry — I'm having a moment of trouble on my end. Can I call you right back?";
      }

      controller.enqueue(enc.encode(JSON.stringify({ text: reply }) + "\n"));
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
