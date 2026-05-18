/**
 * Point the configured AgentPhone agent at our webhook receiver.
 *
 *   WEBHOOK_BASE_URL=https://<id>.ngrok-free.app \
 *     npx tsx --env-file=.env.local scripts/configure-agentphone-webhook.ts
 *
 * Reads AGENTPHONE_AGENT_ID + AGENTPHONE_API_KEY from env, computes the full
 * URL as `${WEBHOOK_BASE_URL}/api/hook/agentphone`, and POSTs to
 * `/v1/agents/{agentId}/webhook`. AgentPhone treats POST on this path as
 * upsert — same call creates or updates.
 *
 * IMPORTANT: AgentPhone generates a NEW signing secret on every upsert.
 * The script prints the secret prominently; copy it into .env.local as
 * `AGENTPHONE_WEBHOOK_SECRET` so the receiver can verify signatures in a
 * later chunk.
 *
 * Tip: `ngrok http 3000` gives you a public URL that forwards to your
 * `next dev` server. Re-run this script every time ngrok hands you a new
 * subdomain. Pass `--delete` to remove the agent webhook entirely.
 *
 * Docs: https://docs.agentphone.ai/documentation/guides/agent-webhooks
 */
const BASE_URL = "https://api.agentphone.ai";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`${name} is not set; check .env.local`);
  }
  return v;
}

interface AgentWebhook {
  id: string;
  url: string;
  secret?: string;
  status?: string;
  contextLimit?: number;
  timeout?: number;
  createdAt?: string;
}

async function getCurrent(
  agentId: string,
  apiKey: string,
): Promise<AgentWebhook | null> {
  const res = await fetch(`${BASE_URL}/v1/agents/${agentId}/webhook`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GET /v1/agents/${agentId}/webhook → ${res.status} ${res.statusText} — ${text}`,
    );
  }
  const json = (await res.json()) as AgentWebhook | null;
  return json ?? null;
}

async function upsert(
  agentId: string,
  apiKey: string,
  url: string,
): Promise<AgentWebhook> {
  const res = await fetch(`${BASE_URL}/v1/agents/${agentId}/webhook`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // contextLimit=5 keeps recentHistory small until we wire real LLM context.
    // timeout=30 matches the default; surface it so future tuning is explicit.
    body: JSON.stringify({ url, contextLimit: 5, timeout: 30 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `POST /v1/agents/${agentId}/webhook → ${res.status} ${res.statusText} — ${text}`,
    );
  }
  return (await res.json()) as AgentWebhook;
}

async function remove(agentId: string, apiKey: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/agents/${agentId}/webhook`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(
      `DELETE /v1/agents/${agentId}/webhook → ${res.status} ${res.statusText} — ${text}`,
    );
  }
}

async function main() {
  const apiKey = need("AGENTPHONE_API_KEY");
  const agentId = need("AGENTPHONE_AGENT_ID");
  const wantDelete = process.argv.includes("--delete");

  console.log("AgentPhone webhook configurator");
  console.log("──────────────────────────────────────────────");
  console.log(`agentId:  ${agentId}`);

  const before = await getCurrent(agentId, apiKey);
  console.log("\nBefore:");
  console.log(before ? `  url: ${before.url}` : "  (no webhook configured)");

  if (wantDelete) {
    await remove(agentId, apiKey);
    console.log("\n✓ Deleted agent webhook.");
    process.exit(0);
  }

  const base = need("WEBHOOK_BASE_URL").replace(/\/+$/, "");
  const url = `${base}/api/hook/agentphone`;
  console.log(`\nTarget:   ${url}`);

  if (before?.url === url) {
    console.log(
      "\nNote: URL is already set to this value, but POSTing anyway " +
        "(AgentPhone rotates the signing secret on every upsert).",
    );
  }

  const after = await upsert(agentId, apiKey, url);

  console.log("\nAfter:");
  console.log(`  id:           ${after.id}`);
  console.log(`  url:          ${after.url}`);
  console.log(`  status:       ${after.status ?? "?"}`);
  console.log(`  contextLimit: ${after.contextLimit ?? "?"}`);
  console.log(`  timeout:      ${after.timeout ?? "?"}s`);

  if (after.secret) {
    console.log("\n──────────────────────────────────────────────");
    console.log("NEW SIGNING SECRET (save in proj-1ad/.env.local):");
    console.log(`  AGENTPHONE_WEBHOOK_SECRET=${after.secret}`);
    console.log("──────────────────────────────────────────────");
    console.log(
      "AgentPhone rotates this on every upsert, so every run prints a " +
        "fresh value. The previous secret immediately stops verifying.",
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("✗ configure-agentphone-webhook failed:", e);
  process.exit(1);
});

export {};
