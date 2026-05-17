/**
 * AgentPhone REST client.
 *
 * Day 2 footprint: thin wrappers around `POST /v1/calls` and
 * `GET /v1/calls/:id`. Later chunks layer on webhook setup, transcript
 * streaming, and per-call dynamic vars without changing this surface.
 *
 * Auth: Bearer token via `AGENTPHONE_API_KEY`.
 * Default agent: `AGENTPHONE_AGENT_ID`.
 *
 * Docs: https://docs.agentphone.ai/documentation/guides/calls
 */
const BASE_URL = "https://api.agentphone.ai";

export interface PlaceCallArgs {
  /** E.164 number we intend to dial (e.g. the contact's stored phone). */
  toNumber: string;
  /** Spoken when the recipient answers. */
  initialGreeting?: string;
  /**
   * When set, AgentPhone uses its built-in LLM (hosted mode) for the entire
   * conversation and never POSTs to our webhook. Use this for connectivity
   * smoke tests before the webhook receiver is online (chunk 3+).
   */
  systemPrompt?: string;
  /** AgentPhone voice id, e.g. "Polly.Amy". Defaults to AgentPhone's pick. */
  voice?: string;
  /** Specific caller-id number id (`num_…`); omit to let AgentPhone choose. */
  fromNumberId?: string;
  /** Override the env default (`AGENTPHONE_AGENT_ID`). */
  agentId?: string;
}

export interface PlacedCall {
  id: string;
  agentId: string;
  phoneNumberId?: string;
  phoneNumber?: string;
  fromNumber?: string;
  toNumber: string;
  direction: "outbound" | "inbound" | "web";
  status: string;
  startedAt?: string;
  endedAt?: string;
  durationSeconds?: number;
}

interface TranscriptTurn {
  id: string;
  transcript: string;
  confidence?: number;
  response?: string;
  createdAt: string;
}

export type CallDetail = PlacedCall & {
  recordingUrl?: string | null;
  recordingAvailable?: boolean;
  transcripts?: TranscriptTurn[];
};

function requireApiKey(): string {
  const key = process.env.AGENTPHONE_API_KEY;
  if (!key) throw new Error("AGENTPHONE_API_KEY is not set");
  return key;
}

/**
 * Place an outbound call. Returns the AgentPhone call record as soon as the
 * dial has been queued; lifecycle (started/ended) is observed via the
 * webhook in chunk 3+ or by polling `getCall(id)`.
 *
 * Dev override: if `TEST_PHONE_OVERRIDE` is set, every call is redirected to
 * that number regardless of `toNumber`. The intended target stays available
 * to callers via the returned record + the `intendedToNumber` log line, so
 * playbook code that records "we called Maya Chen" stays accurate while you,
 * physically, answer the phone.
 */
export async function placeCall(args: PlaceCallArgs): Promise<PlacedCall> {
  const apiKey = requireApiKey();
  const agentId = args.agentId ?? process.env.AGENTPHONE_AGENT_ID;
  if (!agentId) {
    throw new Error("AGENTPHONE_AGENT_ID is not set and no agentId arg given");
  }

  const intendedTo = args.toNumber;
  const override = process.env.TEST_PHONE_OVERRIDE;
  const toNumber = override && override.length > 0 ? override : intendedTo;
  if (override && override !== intendedTo) {
    console.log(
      `[agentphone] dev-override: would have dialed ${intendedTo}, dialing ${override} instead`,
    );
  }

  // AgentPhone seems to require an explicit fromNumberId for webhook-mode
  // agents when the per-agent webhook is null — without it, /v1/calls 400s
  // with "Agent has no phone number assigned" even when the number IS
  // attached. Default to AGENTPHONE_NUMBER_ID env to dodge that.
  const fromNumberId = args.fromNumberId ?? process.env.AGENTPHONE_NUMBER_ID;

  const body: Record<string, unknown> = { agentId, toNumber };
  if (args.initialGreeting) body.initialGreeting = args.initialGreeting;
  if (args.systemPrompt) body.systemPrompt = args.systemPrompt;
  if (args.voice) body.voice = args.voice;
  if (fromNumberId && fromNumberId !== "pp") body.fromNumberId = fromNumberId;

  const res = await fetch(`${BASE_URL}/v1/calls`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `AgentPhone POST /v1/calls failed: ${res.status} ${res.statusText} — ${text}`,
    );
  }

  return (await res.json()) as PlacedCall;
}

/** Fetch full call details including transcripts. */
export async function getCall(callId: string): Promise<CallDetail> {
  const apiKey = requireApiKey();

  const res = await fetch(`${BASE_URL}/v1/calls/${callId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `AgentPhone GET /v1/calls/${callId} failed: ${res.status} ${res.statusText} — ${text}`,
    );
  }

  return (await res.json()) as CallDetail;
}

export interface ListCallsArgs {
  limit?: number;
  offset?: number;
  status?: "completed" | "in-progress" | "failed";
  direction?: "inbound" | "outbound" | "web";
  search?: string;
}

export interface ListCallsResponse {
  data: CallDetail[];
  hasMore: boolean;
  total: number;
}

/** List calls, optionally filtered by status / direction / number search. */
export async function listCalls(
  args: ListCallsArgs = {},
): Promise<ListCallsResponse> {
  const apiKey = requireApiKey();

  const params = new URLSearchParams();
  if (args.limit != null) params.set("limit", String(args.limit));
  if (args.offset != null) params.set("offset", String(args.offset));
  if (args.status) params.set("status", args.status);
  if (args.direction) params.set("direction", args.direction);
  if (args.search) params.set("search", args.search);

  const qs = params.toString();
  const url = `${BASE_URL}/v1/calls${qs ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `AgentPhone GET /v1/calls failed: ${res.status} ${res.statusText} — ${text}`,
    );
  }

  return (await res.json()) as ListCallsResponse;
}

/**
 * Force-end an active call.
 *
 * Endpoint: `POST /v1/calls/{call_id}/end` (per API reference index, not on
 * the main guide page). Some endpoints return 204 No Content with no body
 * on success — we tolerate that and return `null` instead of trying to
 * JSON-parse an empty response.
 */
export async function endCall(callId: string): Promise<unknown | null> {
  const apiKey = requireApiKey();

  const res = await fetch(`${BASE_URL}/v1/calls/${callId}/end`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(
      `AgentPhone POST /v1/calls/${callId}/end failed: ${res.status} ${res.statusText} — ${bodyText || "(empty body)"}`,
    );
  }

  if (!bodyText.trim()) return null;
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}
