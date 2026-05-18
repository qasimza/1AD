/**
 * Print the most recent rows in the `calls` table — quick check that
 * webhook lifecycle persistence is landing rows the way we expect.
 *
 *   npx tsx --env-file=.env.local scripts/show-calls.ts
 *
 * For each row: AgentPhone id, contact name, direction, started/ended,
 * outcome, and a one-line transcript preview.
 */
import { desc, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { calls, contacts } from "@/db/schema";

interface TranscriptTurn {
  role: "agent" | "user";
  content: string;
}

function previewTranscript(raw: string | null): string {
  if (!raw) return "(none)";
  try {
    const parsed = JSON.parse(raw) as TranscriptTurn[];
    if (!Array.isArray(parsed) || parsed.length === 0) return "(empty)";
    return parsed
      .slice(0, 4)
      .map((t) => `[${t.role}] ${t.content}`)
      .join(" | ")
      .slice(0, 240);
  } catch {
    // Not JSON — print first chunk verbatim.
    return raw.slice(0, 240);
  }
}

function fmt(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

async function main() {
  const rows = await db
    .select({
      id: calls.id,
      agentphoneCallId: calls.agentphoneCallId,
      direction: calls.direction,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      startedAt: calls.startedAt,
      endedAt: calls.endedAt,
      outcome: calls.outcome,
      transcript: calls.transcript,
    })
    .from(calls)
    .leftJoin(contacts, eq(contacts.id, calls.contactId))
    .orderBy(desc(calls.startedAt))
    .limit(10);

  if (rows.length === 0) {
    console.log("No calls recorded yet.");
    process.exit(0);
  }

  console.log(`Last ${rows.length} call(s) (newest first):`);
  console.log("──────────────────────────────────────────────");
  for (const r of rows) {
    const contact = r.contactName
      ? `${r.contactName} (${r.contactPhone ?? "no phone"})`
      : "(no contact linked)";
    console.log(`  • ${r.agentphoneCallId}`);
    console.log(`      id:        ${r.id}`);
    console.log(`      direction: ${r.direction}`);
    console.log(`      contact:   ${contact}`);
    console.log(`      started:   ${fmt(r.startedAt)}`);
    console.log(`      ended:     ${fmt(r.endedAt)}`);
    console.log(`      outcome:   ${r.outcome ?? "(open)"}`);
    console.log(`      preview:   ${previewTranscript(r.transcript)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ show-calls failed:", e);
  process.exit(1);
});
