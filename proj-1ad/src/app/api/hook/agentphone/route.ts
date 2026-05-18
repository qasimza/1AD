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
 * Chunk 3 scope: no LLM, no DB writes. Just prove the AgentPhone → 1ad
 * webhook loop is alive by echoing the user's transcript back to them.
 * Chunk 4 layers DB persistence on top, chunk 5 swaps the canned echo for
 * Gemini 3.1 Pro.
 *
 * Security: every delivery carries `X-Webhook-Signature` (HMAC-SHA256 over
 * `${timestamp}.${rawBody}`) and `X-Webhook-Timestamp`. We log presence
 * today and ship verification when the secret stabilises in env (chunk 5).
 *
 * Docs: https://docs.agentphone.ai/documentation/guides/webhooks
 */
import type { NextRequest } from "next/server";

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

interface WebhookEnvelope {
  event: string;
  channel: string;
  timestamp: string;
  agentId: string;
  data: unknown;
  conversationState?: unknown;
  recentHistory?: Array<{
    content: string;
    direction: "inbound" | "outbound";
    channel: string;
    at: string;
  }>;
}

function ndjsonStream(
  chunks: Array<Record<string, unknown>>,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(enc.encode(JSON.stringify(c) + "\n"));
      }
      controller.close();
    },
  });
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
  const sigPresent = req.headers.get("x-webhook-signature") != null;

  // Friendly base log every event shares — easy to grep in `next dev`.
  console.log("[agentphone-hook] ←", {
    deliveryId,
    sigPresent,
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

  // Chunk 3 canned reply: echo the transcript so the test caller can
  // immediately tell whether AgentPhone actually parsed their speech and
  // whether THIS server (not a stale ngrok target) handled the turn.
  const reply = data.transcript
    ? `Webhook is alive. I heard you say: "${data.transcript}".`
    : "Webhook is alive, but I did not catch what you said.";

  return new Response(ndjsonStream([{ text: reply }]), {
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
