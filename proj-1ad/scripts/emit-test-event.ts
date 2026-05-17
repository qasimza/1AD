/**
 * Day 2 chunk 1 verify: inserts a single boot event into the `events` table
 * for the seeded production so we know the orchestrator's only writer path
 * is wired correctly.
 *
 *   npx tsx --env-file=.env scripts/emit-test-event.ts
 */
import { db } from "@/db/client";
import { productions, events } from "@/db/schema";
import { recordEvent } from "@/lib/orchestrator/events";
import { desc, eq } from "drizzle-orm";

async function main() {
  const [prod] = await db.select().from(productions).limit(1);
  if (!prod) {
    throw new Error("No production found. Run `npx tsx src/db/seed.ts` first.");
  }

  const id = await recordEvent({
    productionId: prod.id,
    kind: "test.boot",
    severity: "info",
    payload: { ranAt: new Date().toISOString(), note: "chunk-1 verify" },
  });

  const [row] = await db
    .select()
    .from(events)
    .where(eq(events.id, id))
    .orderBy(desc(events.id))
    .limit(1);

  console.log("✓ recorded event");
  console.log("  id:        ", row.id);
  console.log("  production:", prod.name);
  console.log("  kind:      ", row.kind);
  console.log("  severity:  ", row.severity);
  console.log("  payload:   ", row.payload);
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ emit-test-event failed:", e);
  process.exit(1);
});
