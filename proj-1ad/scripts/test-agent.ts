/**
 * Standalone smoke test for the One A.D. agent.
 *
 * What this proves before you spend AgentPhone minutes on a live call:
 *   1. `OPENAI_API_KEY` is set and the configured `LLM_MODEL` is reachable.
 *   2. The Agents SDK is wired correctly: tools are defined, the run loop
 *      executes, and the model produces a sensible reply.
 *   3. Tool calls actually fire against the real database — `get_call_time`
 *      pulls from `call_times`, `record_confirmation` writes to it.
 *
 * Run:
 *   npx tsx scripts/test-agent.ts
 *
 * Optional env:
 *   AGENT_TEST_CONTACT_ID=<uuid>     // skip auto-pick of test contact
 *   AGENT_TEST_PRODUCTION_ID=<uuid>  // skip auto-pick of test production
 *   AGENT_TEST_USER_TURN="..."       // what the "user" says
 */
import "dotenv/config";
import { and, asc, eq, gt } from "drizzle-orm";

import { db } from "@/db/client";
import { calls, callTimes, contacts, productions } from "@/db/schema";
import { runOneAD } from "@/lib/agent/one-ad";

async function main() {
  const userTurn =
    process.env.AGENT_TEST_USER_TURN ??
    "Hey, sorry — who's this? What's the call time again?";

  // Pick a contact who has an upcoming call_time row so the tools have
  // something real to return. Falls back to the first production+contact
  // if no call_time exists yet.
  let productionId = process.env.AGENT_TEST_PRODUCTION_ID;
  let contactId = process.env.AGENT_TEST_CONTACT_ID;

  if (!productionId || !contactId) {
    const [pick] = await db
      .select({
        productionId: callTimes.productionId,
        contactId: callTimes.contactId,
      })
      .from(callTimes)
      .where(gt(callTimes.callAt, new Date()))
      .orderBy(asc(callTimes.callAt))
      .limit(1);

    if (pick) {
      productionId ??= pick.productionId;
      contactId ??= pick.contactId;
    } else {
      const [p] = await db.select().from(productions).limit(1);
      const [c] = await db.select().from(contacts).limit(1);
      if (!p || !c) {
        throw new Error(
          "no production/contact in DB — run `npx tsx src/db/seed.ts` first",
        );
      }
      productionId ??= p.id;
      contactId ??= c.id;
    }
  }

  const [contact] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);
  const [production] = await db
    .select()
    .from(productions)
    .where(eq(productions.id, productionId))
    .limit(1);

  if (!contact || !production) {
    throw new Error(
      `lookup failed for production ${productionId} / contact ${contactId}`,
    );
  }

  // Use a synthetic call row so write tools have a FK to point at.
  // We don't go through AgentPhone — this is purely a model+tool harness.
  const [synthetic] = await db
    .insert(calls)
    .values({
      productionId: production.id,
      contactId: contact.id,
      direction: "outbound",
      agentphoneCallId: `synthetic-agent-test-${Date.now()}`,
    })
    .returning({ id: calls.id });

  console.log("─".repeat(60));
  console.log("Agent smoke test");
  console.log("  production :", production.name, `(${production.id})`);
  console.log("  contact    :", contact.name, contact.role, `(${contact.id})`);
  console.log("  user turn  :", userTurn);
  console.log("  callDbId   :", synthetic.id, "(synthetic)");
  console.log("─".repeat(60));

  const t0 = Date.now();
  const result = await runOneAD({
    context: {
      callDbId: synthetic.id,
      agentphoneCallId: `synthetic-agent-test-${synthetic.id}`,
      productionId: production.id,
      contactId: contact.id,
    },
    userTurn,
    callInfo: {
      productionName: production.name,
      contactName: contact.name,
      contactRole: contact.role,
      purpose:
        "Confirm the recipient is good for their next call time and surface any conflicts.",
    },
  });

  console.log();
  console.log(`reply (${Date.now() - t0}ms):`);
  console.log("  " + result.reply.split("\n").join("\n  "));
  console.log();
  console.log("tools called:", result.toolCalls);
  console.log("lastResponseId:", result.lastResponseId);
  if (result.hangupRequested) {
    console.log("hangup requested:", result.hangupRequested);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
