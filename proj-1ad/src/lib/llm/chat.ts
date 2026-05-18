/**
 * Provider-agnostic chat wrapper for in-call replies.
 *
 * Day 2 contract: one async call, returns the model's full reply text.
 * Streaming is handled at the webhook layer (interim NDJSON chunk while
 * we wait), not here. Tool calling lives in chunk 6.
 *
 * Default backend: OpenAI gpt-5.4-mini (released March 17, 2026). Picked
 * for sub-second latency on short voice replies, mature function-calling
 * surface for chunk 6, and tight instruction following on length.
 *
 * Swap via env: set `LLM_MODEL=...` to use a different OpenAI model
 * (e.g. `gpt-5.4-nano` for even lower latency / weaker quality, or
 * `gpt-5.5` for the flagship). To move to a different provider entirely
 * (Anthropic, Gemini, etc.) replace the `chat` implementation below;
 * the route layer is provider-blind.
 *
 * Docs: https://developers.openai.com/api/docs/models
 */
import OpenAI from "openai";

export const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-5.4-mini";

let _client: OpenAI | null = null;

function client(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

export interface ChatMessage {
  /** "assistant" matches OpenAI/Anthropic; we map AgentPhone's "outbound" to this. */
  role: "user" | "assistant";
  text: string;
}

export interface ChatArgs {
  /** Persona / guardrails. Sent as the system message. */
  system: string;
  /** Prior turns. Newest last. */
  history: ChatMessage[];
  /** The new user turn to reply to. */
  user: string;
  /**
   * Cap on reply size. Defaults to 256 — short voice replies stay snappy
   * and AgentPhone TTS doesn't run long.
   */
  maxOutputTokens?: number;
}

/**
 * One-shot chat completion. Returns the text the agent should speak.
 *
 * Throws on empty/missing content so the caller can fall back to a canned
 * reply — silence is the worst possible outcome on a live phone call.
 */
export async function chat(args: ChatArgs): Promise<string> {
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    { role: "system", content: args.system },
    ...args.history.map((m) => ({ role: m.role, content: m.text })),
    { role: "user", content: args.user },
  ];

  const res = await client().chat.completions.create({
    model: LLM_MODEL,
    messages,
    // GPT-5 family uses `max_completion_tokens`; `max_tokens` is deprecated.
    max_completion_tokens: args.maxOutputTokens ?? 256,
    // Some newer OpenAI models reject custom temperature; 0.7 is the
    // default for ones that accept it, so omitting is also safe — but
    // we set it explicitly to be deterministic about the call shape.
    temperature: 0.7,
  });

  const text = res.choices[0]?.message?.content?.trim();
  if (!text || text.length === 0) {
    throw new Error("OpenAI returned empty content");
  }
  return text;
}
