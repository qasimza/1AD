/**
 * Read-only inspector for the AgentPhone project tied to AGENTPHONE_API_KEY.
 *
 *   npx tsx --env-file=.env.local scripts/show-agentphone-config.ts
 *
 * Prints every agent, every number, and the current project + per-agent
 * webhook configuration so you can copy the right ids into .env.local
 * without clicking through the dashboard.
 */
const BASE_URL = "https://api.agentphone.ai";

function requireKey(): string {
  const k = process.env.AGENTPHONE_API_KEY;
  if (!k) throw new Error("AGENTPHONE_API_KEY is not set");
  return k;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${requireKey()}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${path} → ${res.status} ${res.statusText} — ${text}`);
  }
  return (await res.json()) as T;
}

async function maybeGet<T>(path: string): Promise<T | { error: string }> {
  try {
    return await get<T>(path);
  } catch (e) {
    return { error: (e as Error).message };
  }
}

interface Agent {
  id: string;
  name: string;
  voiceMode?: string;
  beginMessage?: string | null;
  numbers?: Array<{ id: string; phoneNumber: string }>;
}

// The Numbers endpoint returns more than just an `attachedAgentId` and the
// real field name varies (we've seen `agentId`, `attachedAgentId`, and a
// nested `agent` object across snapshots). To avoid lying about attachment
// state, we print the full raw row instead of guessing one field.
interface NumberRow {
  id: string;
  phoneNumber: string;
  [k: string]: unknown;
}

async function main() {
  console.log("AgentPhone project inspector");
  console.log("──────────────────────────────────────────────");

  const agents = await get<{ data: Agent[] }>("/v1/agents?limit=50");
  console.log(`\nAgents (${agents.data.length}):`);
  for (const a of agents.data) {
    const numList =
      a.numbers && a.numbers.length > 0
        ? a.numbers.map((n) => `${n.phoneNumber} (${n.id})`).join(", ")
        : "(no attached numbers)";
    console.log(`  • ${a.name}`);
    console.log(`      id:        ${a.id}`);
    console.log(`      voiceMode: ${a.voiceMode ?? "?"}`);
    console.log(`      numbers:   ${numList}`);
  }

  const numbers = await get<{ data: NumberRow[] }>("/v1/numbers?limit=50");
  console.log(`\nNumbers (${numbers.data.length}):`);
  for (const n of numbers.data) {
    console.log(`  • ${n.phoneNumber}  (${n.id})`);
    // Print the full raw row indented so the real attachment fields are
    // visible without us pretending to know which one AgentPhone returns.
    const raw = JSON.stringify(n, null, 2).replace(/\n/g, "\n      ");
    console.log(`      ${raw}`);
  }

  const projectHook = await maybeGet("/v1/webhooks");
  console.log("\nProject webhook (GET /v1/webhooks):");
  console.log("  " + JSON.stringify(projectHook, null, 2).replace(/\n/g, "\n  "));

  console.log("\nPer-agent webhooks (GET /v1/agents/<id>/webhook):");
  for (const a of agents.data) {
    const hook = await maybeGet(`/v1/agents/${a.id}/webhook`);
    console.log(`  • ${a.name} (${a.id}):`);
    console.log(
      "      " + JSON.stringify(hook, null, 2).replace(/\n/g, "\n      "),
    );
  }

  console.log("\n──────────────────────────────────────────────");
  console.log("Copy the right ids into proj-1ad/.env.local:");
  console.log("  AGENTPHONE_AGENT_ID=<agent id from above>");
  console.log("  AGENTPHONE_NUMBER_ID=<number id from above>");
  console.log("  AGENTPHONE_NUMBER=<phone number, E.164>");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ show-agentphone-config failed:", e);
  process.exit(1);
});

export {};
