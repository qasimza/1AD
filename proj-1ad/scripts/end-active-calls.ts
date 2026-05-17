/**
 * Operational helper: lists every in-progress AgentPhone call on the project
 * and force-ends each one via `POST /v1/calls/{id}/end`. Useful when an
 * inbound call (e.g. a stray robocall) gets stuck and blocks outbound dials
 * with the 409 "only one call per number is allowed" error.
 *
 *   npx tsx --env-file=.env.local scripts/end-active-calls.ts
 */
import { endCall, listCalls } from "@/lib/voice/agentphone";

async function main() {
  const active = await listCalls({ status: "in-progress", limit: 50 });
  console.log(`[end-active-calls] found ${active.total} active call(s)`);

  if (active.total === 0) {
    console.log("✓ nothing to end");
    process.exit(0);
  }

  let succeeded = 0;
  let failed = 0;

  for (const call of active.data) {
    const tag = `${call.id} (${call.direction} ${call.fromNumber ?? "?"} → ${call.toNumber})`;
    try {
      const result = await endCall(call.id);
      console.log(`  ✓ ended ${tag}`);
      if (result != null) console.log("     response:", result);
      succeeded += 1;
    } catch (e) {
      console.log(`  ✗ failed  ${tag}`);
      console.log("     error:", (e as Error).message);
      failed += 1;
    }
  }

  console.log(`done: ${succeeded} ended, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("✗ end-active-calls failed:", e);
  process.exit(1);
});
