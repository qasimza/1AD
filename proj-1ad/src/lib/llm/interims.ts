/**
 * Interim fillers spoken while we wait for Gemini.
 *
 * AgentPhone's NDJSON contract lets us send a `{interim: true}` chunk
 * immediately and a final chunk later — TTS starts the interim while we
 * still hold the connection. That gap, untreated, is dead air on the
 * phone (Gemini 3.1 Pro is ~600ms-2s for a short reply). One short
 * filler word cuts perceived latency dramatically.
 *
 * Variants stay small and emotionally neutral. They are NOT a substitute
 * for the real reply; the model still answers in the final chunk.
 */
const FILLERS = [
  "One sec.",
  "Got it.",
  "Okay.",
  "Sure — one moment.",
  "Mm — let me think.",
  "Right.",
];

/**
 * Pick a random filler. Random rather than round-robin so back-to-back
 * turns don't repeat the same word.
 */
export function pickInterim(): string {
  return FILLERS[Math.floor(Math.random() * FILLERS.length)];
}
