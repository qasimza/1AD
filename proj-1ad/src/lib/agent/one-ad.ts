/**
 * One A.D. agent — the actual agent loop replacing the chunk-5 chat
 * wrapper.
 *
 * Lifecycle per webhook turn:
 *   1. Webhook fires with the user's latest spoken utterance.
 *   2. Webhook calls `runOneAD(...)` with the call context + utterance.
 *   3. The Agents SDK runs its loop:
 *        a. send instructions + tools + user input to gpt-5.4-mini
 *        b. model emits tool calls; SDK executes them locally
 *        c. tool results fed back into the model
 *        d. repeat until the model produces a final spoken reply
 *   4. Webhook reads `result.finalOutput` and streams it via NDJSON.
 *   5. Webhook stashes `result.lastResponseId` so the NEXT turn
 *      continues from server-managed state (no manual history Map).
 *
 * Why `previousResponseId` rather than client-managed history:
 *   - The Responses API persists the prior turn's items server-side.
 *   - We pass only the new user utterance + an id. No replay, no
 *     bookkeeping, no drift between what we think the model saw vs.
 *     what it actually saw.
 *   - This is the single cleanest fix for the "agent keeps re-
 *     introducing itself" symptom from chunk 5.
 */
import { Agent, run } from "@openai/agents";

import { baseCallSystemPrompt, genericCallSystemPrompt } from "@/lib/llm/prompts";
import { type AgentContext, oneADTools } from "@/lib/agent/tools";

export const ONE_AD_MODEL = process.env.LLM_MODEL ?? "gpt-5.4-mini";

export interface RunOneADArgs {
  context: AgentContext;
  userTurn: string;
  /** Last response id from a prior turn on this call, if any. */
  previousResponseId?: string;
  /** Per-call info that personalises the system prompt. */
  callInfo: {
    productionName: string;
    contactName?: string | null;
    contactRole?: string | null;
    /** Reason for this specific call — chunk 7 will template this. */
    purpose?: string;
  } | null;
}

export interface RunOneADResult {
  reply: string;
  lastResponseId: string | null;
  hangupRequested?: { reason: string };
  /** Per-tool execution summary, useful for logs and the live event feed. */
  toolCalls: Array<{ name: string; ok: boolean }>;
  latencyMs: number;
}

/**
 * Build the agent fresh per turn. Cheap (no network), and lets us pass
 * dynamic instructions without poking at SDK internals.
 *
 * When `isFirstTurn` is true we append a one-line directive forcing the
 * agent to open with the full proactive introduction — required
 * because AgentPhone's webhook mode does NOT auto-play `initialGreeting`
 * for us. Without this, the call connects silent and waits for the user
 * to speak before anything happens.
 */
function buildAgent(args: RunOneADArgs, isFirstTurn: boolean) {
  const base = args.callInfo
    ? baseCallSystemPrompt({
        productionName: args.callInfo.productionName,
        contactName: args.callInfo.contactName ?? undefined,
        contactRole: args.callInfo.contactRole ?? undefined,
        purpose: args.callInfo.purpose,
      })
    : genericCallSystemPrompt();

  const instructions = isFirstTurn
    ? `${base}\n\nFIRST-TURN DIRECTIVE: The call has just connected. The user has picked up but hasn't been introduced to you yet — any greeting they uttered ("hello?", "yes?", silence) is just them confirming they're on the line. Your reply MUST open with the COMPLETE proactive introduction: identify yourself as One A.D., name the production, state why you're calling, and ask if you're speaking with the right person. Do NOT skip the introduction even if they asked a question first — answer them AFTER introducing yourself.\n\nCRITICAL: On THIS first turn, do NOT call any tools. Tools come in step 2 of the call structure AFTER identity is confirmed. Your only output for this turn is the spoken introduction text — nothing else.`
    : base;

  return new Agent({
    name: "One A.D.",
    instructions,
    tools: oneADTools,
    model: ONE_AD_MODEL,
  });
}

export async function runOneAD(args: RunOneADArgs): Promise<RunOneADResult> {
  const started = Date.now();
  const isFirstTurn = !args.previousResponseId;
  const agent = buildAgent(args, isFirstTurn);

  // The context object is what tools read/write. We hand the SAME
  // object to the runner so any tool that mutates it (e.g. end_call
  // setting hangupRequested) is visible to us afterwards.
  const ctx: AgentContext = { ...args.context };

  // On the first turn, hand the model a fixed `[call connected]`
  // marker so the proactive intro fires whether or not the user
  // actually spoke. Subsequent turns use the user's real transcript.
  const userInput = isFirstTurn
    ? `[CALL CONNECTED — user's first utterance: "${args.userTurn || "(silence)"}"]`
    : args.userTurn;

  const result = await run(agent, userInput, {
    context: ctx,
    previousResponseId: args.previousResponseId,
    // Cap the inner tool-calling loop. Voice budget can't afford 10
    // round trips; 4 is enough for "look up call time → look up
    // scenes → record confirmation → speak".
    maxTurns: 4,
  });

  const toolCalls: Array<{ name: string; ok: boolean }> = [];
  for (const item of result.newItems ?? []) {
    if (item.type === "tool_call_item") {
      const name =
        ("name" in item.rawItem ? (item.rawItem as { name?: string }).name : undefined) ?? "unknown";
      toolCalls.push({ name, ok: true });
    }
  }

  return {
    reply: typeof result.finalOutput === "string" ? result.finalOutput : "",
    lastResponseId: result.lastResponseId ?? null,
    hangupRequested: ctx.hangupRequested,
    toolCalls,
    latencyMs: Date.now() - started,
  };
}
