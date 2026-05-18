/**
 * Day 2 chunk 3 smoke test: places one webhook-mode outbound call so the
 * configured AgentPhone agent calls our `/api/hook/agentphone` receiver
 * for every user turn.
 *
 *   npx tsx --env-file=.env.local scripts/test-webhook-call.ts
 *
 * Prerequisites:
 *   1. `next dev` running on :3000
 *   2. `ngrok http 3000` exposing it publicly
 *   3. The agent's webhook is set to `${TUNNEL}/api/hook/agentphone`
 *      (run `scripts/configure-agentphone-webhook.ts` once).
 *
 * Difference vs. `test-place-call.ts`: we DO NOT send `systemPrompt`, so
 * AgentPhone does not use its built-in LLM and instead delegates every
 * user turn to the webhook. The greeting still comes from
 * `initialGreeting` because AgentPhone TTS speaks that locally before any
 * webhook traffic.
 *
 * Expected behaviour:
 *   - Your phone rings, you hear the greeting.
 *   - You say anything; you hear the agent reply
 *     "Webhook is alive. I heard you say: '<your words>'."
 *   - `next dev` logs every turn (and the final `agent.call_ended` event).
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

  const result = await placeCall({
    toNumber: target.phone,
    initialGreeting:
      "Hi, this is one ad — webhook test. Say anything after the beep and " +
      "I'll repeat it back.",
    // Intentionally NO systemPrompt — that flips AgentPhone into hosted mode
    // and short-circuits the webhook, which is the opposite of what we want.
  });

  console.log("✓ outbound call placed");
  console.log("  call id:   ", result.id);
  console.log("  agent id:  ", result.agentId);
  console.log("  to:        ", result.toNumber);
  console.log("  status:    ", result.status);
  console.log();
  console.log(
    "Now: answer the phone, say something, listen for the echo, and watch " +
      "the `next dev` log for `[agentphone-hook]` lines.",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ test-webhook-call failed:", e);
  process.exit(1);
});
