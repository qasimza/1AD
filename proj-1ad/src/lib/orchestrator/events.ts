import { db } from "@/db/client";
import { events } from "@/db/schema";

export type EventSeverity = "info" | "watch" | "live";

export interface EventInput {
  productionId: string;
  kind: string;
  severity: EventSeverity;
  payload: Record<string, unknown>;
}

/**
 * Single writer into the `events` table.
 *
 * Per TDD §2.3 "the orchestrator is the single writer": webhook handlers,
 * server actions, and playbooks all route here so the dashboard's SSE/poll
 * feed has one source of truth and event ordering is preserved by Postgres.
 *
 * Returns the inserted row's id so call sites can correlate (e.g. a playbook
 * dispatch wants to know which event id fired its run).
 */
export async function recordEvent(input: EventInput): Promise<number> {
  const [row] = await db
    .insert(events)
    .values({
      productionId: input.productionId,
      kind: input.kind,
      severity: input.severity,
      payload: input.payload,
    })
    .returning({ id: events.id });
  return row.id;
}

/**
 * Batch insert variant — used by `tick.flushEvents` and any playbook that
 * builds up a list of `EventInput` over the course of one run.
 */
export async function recordEvents(inputs: EventInput[]): Promise<number[]> {
  if (inputs.length === 0) return [];
  const rows = await db
    .insert(events)
    .values(
      inputs.map((i) => ({
        productionId: i.productionId,
        kind: i.kind,
        severity: i.severity,
        payload: i.payload,
      })),
    )
    .returning({ id: events.id });
  return rows.map((r) => r.id);
}
