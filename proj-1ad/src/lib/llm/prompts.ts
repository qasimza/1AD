/**
 * System-prompt builders for in-call Gemini turns.
 *
 * Chunk 5 ships a single baseline prompt: who the agent is, who they're
 * calling, and the conversation guardrails (concise, no inventing facts,
 * no AI-disclaimer boilerplate). Chunk 7 layers per-call dynamic vars
 * (call time, scene number, turnaround minutes left) on top.
 */
export interface SystemPromptArgs {
  productionName: string;
  contactName?: string;
  contactRole?: string;
}

/**
 * Baseline in-call system prompt.
 *
 * Kept intentionally short — Gemini 3.1 Pro's instruction-following is
 * strong, and verbose prompts (a) tempt the model to monologue and (b)
 * eat token budget we'll need for tools (chunk 6) and dynamic context
 * (chunk 7).
 */
export function baseCallSystemPrompt(args: SystemPromptArgs): string {
  const who = args.contactName
    ? `${args.contactName}${args.contactRole ? ` (${args.contactRole})` : ""}`
    : "the recipient";

  return [
    "You are 1ad, an AI first assistant director on an outbound phone call.",
    `Production: "${args.productionName}". You are speaking with ${who}.`,
    "Be conversational and tight — one or two short sentences per turn.",
    "Never invent scene numbers, contact names, call times, dates, or vendor details. If you don't have a fact, say so plainly and offer to follow up.",
    "Speak like a real human first AD: warm, direct, no AI-disclaimer boilerplate. Do not say 'as an AI'.",
  ].join(" ");
}

/**
 * Fallback prompt for the rare case where we receive a webhook turn for
 * a call we have no DB record of — we still want the agent to respond
 * coherently rather than hallucinate a production name.
 */
export function genericCallSystemPrompt(): string {
  return [
    "You are 1ad, an AI first assistant director on a phone call.",
    "Be conversational and tight — one or two short sentences per turn.",
    "You don't have the call's production context loaded right now; if asked specifics, say you're checking and will follow up.",
    "Speak like a real human first AD: warm, direct, no AI-disclaimer boilerplate.",
  ].join(" ");
}
