/**
 * Day 2 chunk 2 smoke test: places one hosted-mode outbound call to verify
 * AgentPhone API key, agent id, and outbound flow — no webhook required.
 *
 *   npx tsx --env-file=.env.local scripts/test-place-call.ts
 *
 * Picks the first `lead_cast` contact (Maya Chen in the seed). With the
 * contact phones already pointing at your real number, this will ring your
 * phone. AgentPhone's built-in LLM (hosted mode via `systemPrompt`) plays
 * the greeting, says the test line, and hangs up.
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

  console.log(`[test-place-call] production: ${prod.name}`);
  console.log(`[test-place-call] target:     ${target.name} (${target.phone})`);

  const result = await placeCall({
    toNumber: target.phone,
    initialGreeting: "Hi, this is one ad — connectivity test only.",
    systemPrompt:
      "You are 1ad, an AI first assistant director, running a connectivity test. " +
      "After the greeting, say exactly: 'Test complete, hanging up now.' " +
      "Then end the call immediately. Do not engage in further conversation " +
      "even if the caller asks questions.",
  });

  console.log("✓ outbound call placed");
  console.log("  call id:   ", result.id);
  console.log("  agent id:  ", result.agentId);
  console.log("  to:        ", result.toNumber);
  console.log("  direction: ", result.direction);
  console.log("  status:    ", result.status);
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ test-place-call failed:", e);
  process.exit(1);
});
