/**
 * LLM smoke test — no phone, no AgentPhone, no DB.
 *
 *   npx tsx --env-file=.env.local scripts/test-llm.ts
 *
 * Runs the same chat() wrapper the webhook uses against a fake mid-call
 * user turn. Confirms:
 *
 *   1. OPENAI_API_KEY (or whichever provider key is configured) loads
 *      from .env.local.
 *   2. The configured model id (default `gpt-5.4-mini`, override via
 *      LLM_MODEL) is accessible to your account.
 *   3. Round-trip latency is acceptable for a real call (<1s ideally).
 *
 * If this fails, the live phone test will fail too — fix this first.
 */
import { chat, LLM_MODEL } from "@/lib/llm/chat";
import { baseCallSystemPrompt } from "@/lib/llm/prompts";

async function main() {
  const system = baseCallSystemPrompt({
    productionName: "ACME Commercial",
    contactName: "Maya Chen",
    contactRole: "lead cast",
  });

  const history = [
    {
      role: "assistant" as const,
      text: "Hi Maya, this is One A.D. — quick check-in on tomorrow's call time.",
    },
  ];

  const userTurn = "Yeah hey, what's up?";

  console.log(`[test-llm] model:  ${LLM_MODEL}`);
  console.log(`[test-llm] system: ${system}`);
  console.log(`[test-llm] user:   ${userTurn}`);

  const t0 = Date.now();
  const reply = await chat({ system, history, user: userTurn });
  const dt = Date.now() - t0;

  console.log("\n──────────────────────────────────────────────");
  console.log(`reply (${dt}ms):`);
  console.log(reply);
  console.log("──────────────────────────────────────────────");
  process.exit(0);
}

main().catch((e) => {
  console.error("✗ test-llm failed:", e);
  process.exit(1);
});
