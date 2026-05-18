/**
 * Post-call SMS recap.
 *
 * After every successful call, the in-call agent has already persisted
 * the call row, the transcript, and any tool side-effects (confirmations
 * / conflicts). This module reads that materialised state, asks the LLM
 * to write a short SMS body, ships it via AgentPhone, and persists the
 * outbound row to our local `messages` table.
 *
 * Why post-call instead of an in-call tool:
 *   - The model gets to focus on having the conversation; it doesn't burn
 *     its turn budget composing two outputs (speech + SMS) at hangup.
 *   - We have the full transcript by this point — including the model's
 *     own final goodbye — so the recap is faithful to what was actually
 *     said, not what the model intended to say.
 *   - Decoupling means SMS failures (carrier rejection, AgentPhone 5xx)
 *     never destabilise the live call.
 *
 * Called fire-and-forget from the `call_ended` branch of
 * `src/app/api/hook/agentphone/route.ts` so it never blocks the
 * webhook ack to AgentPhone.
 */
import OpenAI from "openai";
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import {
  calls,
  contacts,
  messages,
  productions,
} from "@/db/schema";
import { recordEvent } from "@/lib/orchestrator/events";
import { sendMessage } from "@/lib/voice/agentphone";

const SUMMARY_MODEL = process.env.LLM_MODEL ?? "gpt-5.4-mini";

/**
 * Outcomes where we DO want to send an SMS recap. A no_answer or
 * voicemail call has no conversation to recap, and a failed call
 * shouldn't trigger an unsolicited text to the contact.
 */
const RECAP_OUTCOMES = new Set(["completed", "hangup"]);

interface TranscriptEntry {
  role: "agent" | "user";
  content: string;
}

/**
 * Read the persisted call row + contact info, summarise the transcript,
 * send the SMS, persist + event. Best-effort: any failure is logged
 * and an `sms.send_failed` event is emitted, but the function never
 * throws — the caller fires-and-forgets.
 */
export async function sendPostCallSummary(callId: string): Promise<void> {
  try {
    const [row] = await db
      .select({
        callId: calls.id,
        productionId: calls.productionId,
        productionName: productions.name,
        contactId: calls.contactId,
        contactName: contacts.name,
        contactRole: contacts.role,
        contactPhone: contacts.phone,
        transcript: calls.transcript,
        outcome: calls.outcome,
      })
      .from(calls)
      .innerJoin(productions, eq(productions.id, calls.productionId))
      .leftJoin(contacts, eq(contacts.id, calls.contactId))
      .where(eq(calls.id, callId))
      .limit(1);

    if (!row) {
      console.warn(
        `[post-call-summary] call ${callId} not found; skipping SMS`,
      );
      return;
    }

    if (!row.contactId || !row.contactPhone) {
      console.warn(
        `[post-call-summary] call ${callId} has no contact phone on file; skipping SMS`,
      );
      return;
    }

    if (!row.outcome || !RECAP_OUTCOMES.has(row.outcome)) {
      console.log(
        `[post-call-summary] call ${callId} outcome=${row.outcome ?? "(null)"}; skipping SMS`,
      );
      return;
    }

    let transcript: TranscriptEntry[] = [];
    if (row.transcript) {
      try {
        const parsed = JSON.parse(row.transcript) as TranscriptEntry[];
        if (Array.isArray(parsed)) transcript = parsed;
      } catch (err) {
        console.warn(
          `[post-call-summary] call ${callId} transcript not valid JSON:`,
          err,
        );
      }
    }

    // No words spoken either way = nothing to recap. Don't text a
    // contact "we called you and you didn't say anything".
    if (transcript.length === 0) {
      console.log(
        `[post-call-summary] call ${callId} has empty transcript; skipping SMS`,
      );
      return;
    }

    const transcriptText = transcript
      .map((t) => `${t.role.toUpperCase()}: ${t.content}`)
      .join("\n");

    const systemPrompt = [
      `You are writing a short follow-up SMS from One A.D. (an AI first assistant director) to ${row.contactName ?? "the contact"} after a phone call about the production "${row.productionName}".`,
      "Write 1-3 short sentences, under 320 characters total.",
      `On the first reference, identify yourself as "One A.D." (with the periods — that's the spelling) on "${row.productionName}".`,
      "State the concrete outcome of the call: a confirmed call time, a flagged conflict and what happens next, a callback commitment, etc.",
      "If the contact raised a problem the line producer is going to follow up on, say so plainly.",
      "Tone: warm but informational — like a coworker texting another coworker.",
      "Hard rules: no AI disclaimers (never say 'as an AI'), no signature line, no links, no emoji.",
      "If the transcript shows the call was inconclusive (wrong number, hang-up before getting anywhere), respond with the exact string SKIP — nothing else. The caller will not send an SMS in that case.",
    ].join(" ");

    const userPrompt = [
      "Call transcript:",
      "",
      transcriptText,
      "",
      "Write the SMS body now. Do not include quotes around it. Just the message text, or the word SKIP.",
    ].join("\n");

    const client = new OpenAI();
    const completion = await client.chat.completions.create({
      model: SUMMARY_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const rawBody = completion.choices[0]?.message?.content?.trim() ?? "";
    if (!rawBody) {
      console.warn(
        `[post-call-summary] call ${callId} model returned empty body; skipping SMS`,
      );
      return;
    }
    if (rawBody === "SKIP") {
      console.log(
        `[post-call-summary] call ${callId} model decided SKIP; no SMS sent`,
      );
      return;
    }

    // Strip surrounding quotes the model sometimes adds even after
    // being told not to.
    const body = rawBody.replace(/^"+|"+$/g, "").trim();

    let sent;
    try {
      sent = await sendMessage({ toNumber: row.contactPhone, body });
    } catch (err) {
      console.error(
        `[post-call-summary] call ${callId} AgentPhone send failed:`,
        err,
      );
      try {
        await recordEvent({
          productionId: row.productionId,
          kind: "sms.send_failed",
          severity: "watch",
          payload: {
            callId,
            contactId: row.contactId,
            toNumber: row.contactPhone,
            bodyPreview: body.slice(0, 160),
            error: (err as Error).message,
            source: "post_call_summary",
          },
        });
      } catch {
        // best-effort
      }
      return;
    }

    // Single-writer for the `messages` table — this is the only path
    // that writes outbound SMS today, but the pattern matches the
    // `calls` single-writer in `calls.ts` so future SMS triggers
    // (turnaround playbook, vendor playbook) plug into the same row.
    const [msg] = await db
      .insert(messages)
      .values({
        productionId: row.productionId,
        contactId: row.contactId,
        direction: "outbound",
        body,
        sentAt: new Date(),
      })
      .returning({ id: messages.id });

    await recordEvent({
      productionId: row.productionId,
      kind: "sms.sent",
      severity: "info",
      payload: {
        messageId: msg.id,
        agentphoneMessageId: sent.id,
        callId,
        contactId: row.contactId,
        toNumber: row.contactPhone,
        bodyPreview: body.slice(0, 160),
        source: "post_call_summary",
      },
    });

    console.log(
      `[post-call-summary] call ${callId} sent SMS msg=${msg.id} to ${row.contactPhone}: "${body.slice(0, 80)}${body.length > 80 ? "…" : ""}"`,
    );
  } catch (err) {
    // We're called fire-and-forget — swallow everything so a broken
    // summariser never poisons the webhook handler. The error is
    // already logged inline where it happens.
    console.error(
      `[post-call-summary] unexpected failure for call ${callId}:`,
      err,
    );
  }
}
