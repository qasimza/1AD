/**
 * Day 2 smoke test: places one webhook-mode outbound call so the
 * configured AgentPhone agent calls our `/api/hook/agentphone` receiver
 * for every user turn, where the One A.D. agent (chunks 5+6) produces
 * the reply and can invoke tools.
 *
 *   npx tsx --env-file=.env.local scripts/test-webhook-call.ts
 *
 * Prerequisites:
 *   1. `next dev` running on :3000
 *   2. `ngrok http 3000` exposing it publicly
 *   3. The agent's webhook is set to `${TUNNEL}/api/hook/agentphone`
 *      (run `scripts/configure-agentphone-webhook.ts` once).
 *   4. OPENAI_API_KEY in .env.local (verified by `scripts/test-agent.ts`).
 *
 * Difference vs. `test-place-call.ts`: we DO NOT send `systemPrompt`, so
 * AgentPhone does not use its built-in LLM and instead delegates every
 * user turn to the webhook. The greeting still comes from
 * `initialGreeting` because AgentPhone TTS speaks that locally before any
 * webhook traffic.
 *
 * Expected behaviour:
 *   - Your phone rings, you hear the greeting.
 *   - You reply naturally; the agent answers like a real first AD
 *     (1-2 sentences, conversational, references your name + production
 *     from the seed data).
 *   - The agent should INVOKE TOOLS when you ask things it can look up
 *     (e.g. "what's the call time?" should trigger `get_call_time`).
 *   - When you confirm or refuse the call time, the agent calls
 *     `record_confirmation` and the `call_times.confirmed_at` column
 *     updates.
 *   - `next dev` logs every turn plus `agent ok in <ms> tools=[...]`
 *     per reply, and a final `agent.call_ended` event with the
 *     persisted outcome.
 */
import { eq } from "drizzle-orm";

import { db } from "@/db/client";
import { contacts, productions } from "@/db/schema";
import { placeCall } from "@/lib/voice/agentphone";

async function main() {
  const [prod] = await db.select().from(productions).limit(1);
  if (!prod) {
    throw new Error("No production found. Run `npx tsx src/db/seed.ts` first.");
  }

  const [target] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.role, "lead_cast"))
    .limit(1);
  if (!target?.phone) {
    throw new Error("No lead_cast contact with a phone number found.");
  }

  console.log(`[test-webhook-call] production: ${prod.name}`);
  console.log(`[test-webhook-call] target:     ${target.name} (${target.phone})`);
  console.log(
    "[test-webhook-call] mode:       webhook (no systemPrompt sent)",
  );

  // We deliberately do NOT pass `initialGreeting`. In webhook mode,
  // AgentPhone's behaviour around the configured greeting is
  // inconsistent (sometimes plays, sometimes silently swallowed) and
  // we got two bad UX outcomes from it: (1) when it didn't play, the
  // caller picked up to silence and had to say "hello?" to wake the
  // agent up; (2) when it did, our webhook also opened with a
  // proactive intro and the caller heard the introduction twice.
  //
  // Instead, the One A.D. agent OWNS the introduction itself: the
  // first webhook turn flips an `isFirstTurn` flag in `runOneAD` that
  // forces the agent to open with a full proactive intro regardless
  // of what the caller said. See `src/lib/agent/one-ad.ts`.

  const result = await placeCall({
    toNumber: target.phone,
    // Intentionally NO systemPrompt — that flips AgentPhone into hosted mode
    // and short-circuits the webhook, which is the opposite of what we want.
    // Passing productionId + contactId opts in to DB persistence (chunk 4):
    // placeCall inserts a `calls` row immediately, the webhook updates it
    // on call_ended.
    productionId: prod.id,
    contactId: target.id,
  });

  console.log("✓ outbound call placed");
  console.log("  agentphone id: ", result.id);
  console.log("  db call id:    ", result.dbCallId ?? "(not persisted)");
  console.log("  agent id:      ", result.agentId);
  console.log("  to:            ", result.toNumber);
  console.log("  status:        ", result.status);
  console.log();
  console.log(
    "Now: answer the phone, have a quick conversation, then hang up. " +
      "Watch the `next dev` log for `[agentphone-hook]` and `llm ok in <ms>` " +
      "lines. After hangup, run `scripts/show-calls.ts` to see the " +
      "persisted transcript.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ test-webhook-call failed:", e);
  process.exit(1);
});
