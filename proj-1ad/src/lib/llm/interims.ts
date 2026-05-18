/**
 * Interim fillers spoken while we wait for the LLM.
 *
 * AgentPhone's NDJSON contract lets us send a `{interim: true}` chunk
 * immediately and a final chunk later — TTS starts the interim while we
 * still hold the connection. That gap, untreated, is dead air on the
 * phone (~500ms-1500ms for short replies). One short filler word cuts
 * perceived latency dramatically.
 *
 * IMPORTANT: these must be CONVERSATIONAL BACKCHANNELS (the "mm-hmm"
 * sound a person makes while listening), not THINKING phrases like
 * "let me think" or "one sec". Backchannels stay natural even when the
 * LLM reply comes back instantly; thinking phrases sound robotic and
 * imply cognitive load that isn't there (e.g. user says "yeah" → agent
 * says "let me think" → reply "Perfect.").
 */
const FILLERS = [
  "Mm-hmm.",
  "Right.",
  "Got it.",
  "Okay.",
  "Yeah.",
  "Sure.",
];

/**
 * Pick a random filler. Random rather than round-robin so back-to-back
 * turns don't repeat the same word.
 */
export function pickInterim(): string {
  return FILLERS[Math.floor(Math.random() * FILLERS.length)];
}
