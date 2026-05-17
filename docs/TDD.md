# 1ad — Technical Design Document

*Hackathon build spec · v1.0 · production black*

---

## 0. Document purpose and shape

This is a build spec for a small team shipping the 1ad hackathon demo in days. It is opinionated where opinions accelerate building, and explicit about tradeoffs where the wrong call would cost a day. It assumes the reader has read the PRD (v1.1) and the brand brief.

The stack is TypeScript end-to-end on Google Cloud — one repo, one deploy target, one type system, with the brand-critical dashboard treated as a first-class part of the build rather than a thin admin panel bolted onto the agent.

---

## 1. Stack decisions

### 1.1 Committed

| Component | Tool | Role |
|---|---|---|
| Telephony | **AgentPhone** | Outbound voice, SMS, inbound numbers, webhooks. PRD-mandated. Calls run Gemini Live as the model. |
| Realtime voice model | **Gemini Live** (`gemini-3.1-flash-live-preview`) | The agent's voice during calls. Low-latency bidirectional audio, function calling mid-call, audio transcription. |
| Payments | **Sponge** | Agent wallet + Sponge card (Visa via Rain). Server-side spend caps. PRD-mandated as of v1.1. |
| Email | **AgentMail** | One inbox per production (`1ad-<production>@agentmail.to`). Escalation summaries to the line producer; updated call sheet distribution. Inbound parsing for replies. |
| Long-term memory | **Supermemory** | Cross-call, cross-day episodic memory. "The location owner mentioned his neighbor complains after 9pm." "The DP prefers text before 7am." |
| In-call retrieval | **Moss** | Sub-10ms semantic search the agent calls *during* a live call (rider clauses, union rules, restrictions) without dead air. |
| App framework | **Next.js 15** (app router, TypeScript) | One codebase: dashboard, API routes, webhooks. Server actions for mutations from the UI. Deployed as a single Cloud Run service. |
| Database | **Cloud SQL Postgres 16** | Structured production state. Drizzle ORM for type-safe access. Cloud SQL Auth Proxy for connection. |
| ORM | **Drizzle** | Lighter than Prisma, no codegen step in the build, end-to-end TypeScript types. |
| Background jobs | **Cloud Scheduler → Cloud Tasks → Cloud Run** | One-minute tick, hourly weather poll, deadline timers. All hit authenticated endpoints on the same Cloud Run service. |
| LLM (orchestration) | **Gemini 2.5 Pro** | For the simulation reasoning, the reshuffle optimizer in Story 5, and SMS intent parsing. Same vendor as Gemini Live keeps tool schemas consistent. |
| File storage | **Google Cloud Storage** | Generated call sheet PDFs, uploaded call sheets at intake. |
| Frontend rendering | **React Server Components + Tailwind v4** | Server-rendered by default. Streaming for the live event feed. |
| Realtime UI updates | **Server-Sent Events** | One-way orchestrator → dashboard, survives reconnection, no extra infra. WebSockets are overkill. |

### 1.2 Considered and dropped

- **BrowserUse.** Only realistic v1 use is scraping permit/vendor sites. Weather is already an API. Adds a failure surface (page changes, captchas, headful browsers on Cloud Run) for marginal demo value. Keep on v2 roadmap.
- **Vapi / LiveKit Agents.** Mature alternatives to AgentPhone. If AgentPhone is unavailable for a sponsor reason, LiveKit + Telnyx SIP is the swap and Gemini Live drops in cleanly. Not the primary path.
- **Prisma.** Heavier than Drizzle for what we need, slower codegen feedback loop, no real advantage at this scale.
- **Firestore.** Faster start, but the schedule is a relational problem (scenes ↔ contacts ↔ call_times ↔ calls) and writing those joins in document queries is a slog.
- **Separate Python orchestrator + Next.js frontend.** Two services, two deploys, two type systems, two ways to be wrong. One Next.js app on Cloud Run is faster.

### 1.3 Tradeoff to acknowledge

Putting the orchestrator inside Next.js means the long-running risk-evaluation tick runs in a request-scoped serverless context. This is fine for the hackathon — ticks are short (target <5s) and Cloud Run handles concurrent requests well — but if the simulation loop ever needs to hold state in-process for minutes, a dedicated worker service becomes the right shape. We design the playbook layer so it can be lifted into a separate service later without a rewrite (see §4.2).

---

## 2. System architecture

### 2.1 Service topology

```
┌────────────────────────────────────────────────────────────────────┐
│                      Google Cloud project                          │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                  1ad-app (Cloud Run, Next.js)                │ │
│  │                                                              │ │
│  │  ┌─────────────┐  ┌────────────┐  ┌──────────────────────┐  │ │
│  │  │  Dashboard  │  │  Webhooks  │  │ Tick / scheduled    │  │ │
│  │  │  (RSC)      │  │  /api/hook │  │ /api/tick           │  │ │
│  │  │  + SSE feed │  │  /agentph  │  │ /api/poll/weather   │  │ │
│  │  │             │  │  /agentml  │  │ /api/deadlines/run  │  │ │
│  │  │             │  │  /sponge   │  │                     │  │ │
│  │  └─────────────┘  └────────────┘  └──────────────────────┘  │ │
│  │                                                              │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │ Orchestrator core (lib/)                             │   │ │
│  │  │  - risk evaluator (deterministic)                    │   │ │
│  │  │  - playbook registry                                 │   │ │
│  │  │  - tool router (the in-call function surface)        │   │ │
│  │  │  - tier engine (Auto / Notify / Escalate)            │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│         │              │              │              │             │
│         ▼              ▼              ▼              ▼             │
│   ┌──────────┐  ┌────────────┐  ┌──────────┐  ┌────────────┐     │
│   │ Cloud    │  │ Cloud      │  │ Cloud    │  │ Secret     │     │
│   │ SQL      │  │ Storage    │  │ Tasks +  │  │ Manager    │     │
│   │ Postgres │  │ (PDFs)     │  │ Scheduler│  │ (keys)     │     │
│   └──────────┘  └────────────┘  └──────────┘  └────────────┘     │
└────────────────────────────────────────────────────────────────────┘
       │                  │                  │              │
       │ webhooks         │ webhooks         │ wallet ops   │ memory + search
       ▼                  ▼                  ▼              ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ AgentPhone   │  │ AgentMail    │  │ Sponge       │  │ Supermemory  │
│ voice + SMS  │  │ inbox/api    │  │ wallet+card  │  │ + Moss       │
│ Gemini Live  │  │              │  │ Visa (Rain)  │  │              │
│ inside calls │  │              │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘
       │
       │ function tools called mid-call
       ▼
   back into 1ad-app via authenticated /api/tools/*
```

### 2.2 Why one Next.js service

Three reasons. First, a single deploy target — `gcloud run deploy` once, no inter-service auth to debug at 2am. Second, the dashboard and the orchestrator share the same schema, the same Drizzle types, the same Zod validators — no contract drift. Third, the realtime UI surface (SSE feed from `events` table) and the realtime agent surface (webhook handlers) are the same data flowing through the same code paths.

The cost: §1.3 tradeoff. If a playbook needs to hold state across many minutes (it shouldn't — see §4.2), we add a worker.

### 2.3 The orchestrator is the single writer

Postgres holds the schedule. Supermemory holds episodic memory. Moss holds embeddings. **Only the orchestrator writes to all three.** Webhook handlers, server actions, and playbooks call into the orchestrator core; nothing else touches the databases directly.

This rule isn't bureaucratic — it's how you keep the agent's view of the world consistent. If a webhook updates Postgres but forgets to update Supermemory, the agent's next call will be wrong, and nobody will know why.

---

## 3. Data model

### 3.1 Drizzle schema (the canonical version)

The full schema lives in `src/db/schema.ts`. Highlights below.

```ts
// src/db/schema.ts
import { pgTable, uuid, text, timestamp, integer, numeric, jsonb,
         boolean, pgEnum, bigserial, index } from "drizzle-orm/pg-core";

export const sceneType = pgEnum("scene_type", [
  "day_ext", "night_ext", "day_int", "night_int",
]);

export const sceneStatus = pgEnum("scene_status", [
  "planned", "confirmed", "rolling", "wrapped", "cancelled", "rescheduled",
]);

export const freshness = pgEnum("freshness", [
  "known", "stale", "missing", "inferred",
]);

export const spendTier = pgEnum("spend_tier", [
  "auto", "notify", "escalate",
]);

export const productions = pgTable("productions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  startDate: timestamp("start_date", { mode: "date" }).notNull(),
  endDate: timestamp("end_date", { mode: "date" }).notNull(),
  timezone: text("timezone").notNull(),
  agentmailInbox: text("agentmail_inbox").notNull(),
  agentphoneNumber: text("agentphone_number").notNull(),
  spongeAgentId: text("sponge_agent_id").notNull(),
  spongeApiKey: text("sponge_api_key").notNull(),  // ref to Secret Manager
  // Tier ceilings, in cents
  tierAutoCeiling: integer("tier_auto_ceiling").notNull().default(50000),       // $500
  tierNotifyCeiling: integer("tier_notify_ceiling").notNull().default(250000),  // $2500
  dailyCapCents: integer("daily_cap_cents").notNull().default(500000),          // $5000
  weeklyCapCents: integer("weekly_cap_cents").notNull().default(2000000),       // $20000
  escalationRules: jsonb("escalation_rules").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull().references(() => productions.id),
  name: text("name").notNull(),
  role: text("role").notNull(),                  // 'lead_cast' | 'dp' | 'vendor' | ...
  phone: text("phone"),
  email: text("email"),
  unionAffiliation: text("union_affiliation"),   // 'SAG' | 'IATSE' | null
  rider: jsonb("rider").notNull().default({}),
  notes: text("notes"),
  supermemoryUserId: text("supermemory_user_id").notNull(),
});

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull().references(() => productions.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  lat: numeric("lat", { precision: 9, scale: 6 }),
  lon: numeric("lon", { precision: 9, scale: 6 }),
  permitExpiresAt: timestamp("permit_expires_at"),
  restrictions: jsonb("restrictions").notNull().default({}),
  ownerContactId: uuid("owner_contact_id").references(() => contacts.id),
  isCoverSet: boolean("is_cover_set").notNull().default(false),
});

export const scenes = pgTable("scenes", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull().references(() => productions.id),
  sceneNumber: text("scene_number").notNull(),
  description: text("description").notNull(),
  type: sceneType("type").notNull(),
  locationId: uuid("location_id").references(() => locations.id),
  estimatedPages: numeric("estimated_pages", { precision: 4, scale: 2 }),
  estimatedSetupMinutes: integer("estimated_setup_minutes"),
  status: sceneStatus("status").notNull().default("planned"),
  plannedStart: timestamp("planned_start"),
  actualStart: timestamp("actual_start"),
  actualWrap: timestamp("actual_wrap"),
  shootDay: integer("shoot_day").notNull(),
  orderWithinDay: integer("order_within_day").notNull(),
});

export const sceneCast = pgTable("scene_cast", {
  sceneId: uuid("scene_id").notNull().references(() => scenes.id),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
}, (t) => ({ pk: index().on(t.sceneId, t.contactId) }));

export const callTimes = pgTable("call_times", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id),
  shootDay: integer("shoot_day").notNull(),
  callAt: timestamp("call_at").notNull(),
  freshness: freshness("freshness").notNull().default("known"),
  confirmedAt: timestamp("confirmed_at"),
  confirmationCallId: uuid("confirmation_call_id"),
});

export const calls = pgTable("calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id),
  direction: text("direction").notNull(),          // 'outbound' | 'inbound'
  agentphoneCallId: text("agentphone_call_id").notNull(),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
  outcome: text("outcome"),                        // 'confirmed' | 'voicemail' | ...
  transcript: text("transcript"),
  structuredResult: jsonb("structured_result"),
  playbook: text("playbook"),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull(),
  contactId: uuid("contact_id").references(() => contacts.id),
  direction: text("direction").notNull(),
  body: text("body").notNull(),
  sentAt: timestamp("sent_at").notNull(),
});

export const emails = pgTable("emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull(),
  agentmailMessageId: text("agentmail_message_id").notNull(),
  direction: text("direction").notNull(),
  subject: text("subject"),
  body: text("body"),
  toAddr: text("to_addr"),
  fromAddr: text("from_addr"),
  sentAt: timestamp("sent_at").notNull(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull(),
  spongeTransactionId: text("sponge_transaction_id").notNull().unique(),
  amountCents: integer("amount_cents").notNull(),
  merchant: text("merchant"),
  category: text("category"),
  tierUsed: spendTier("tier_used").notNull(),
  status: text("status").notNull(),                // 'authorized' | 'captured' | 'declined' | 'refunded'
  playbookRunId: uuid("playbook_run_id"),
  contactId: uuid("contact_id").references(() => contacts.id),
  notifiedAt: timestamp("notified_at"),            // when line producer was SMS'd
  approvedAt: timestamp("approved_at"),            // for escalate tier
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  productionId: uuid("production_id").notNull(),
  kind: text("kind").notNull(),                    // 'risk.detected', 'call.completed', ...
  severity: text("severity").notNull(),            // 'info' | 'watch' | 'live'
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  idxTime: index("idx_events_prod_time").on(t.productionId, t.createdAt),
}));

export const risks = pgTable("risks", {
  id: uuid("id").primaryKey().defaultRandom(),
  productionId: uuid("production_id").notNull(),
  kind: text("kind").notNull(),                    // 'weather' | 'turnaround' | ...
  severity: text("severity").notNull(),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  context: jsonb("context").notNull(),
  playbookRunId: uuid("playbook_run_id"),
});
```

### 3.2 Memory layering

Two stores, two jobs.

**Postgres** holds anything the agent reasons over deterministically — schedule, who's in what scene, call times, union flags, transactions. If it would fit in a spreadsheet, it lives here.

**Supermemory** holds anything the agent recalls fuzzily across days and calls — "the location owner's neighbor complains after 9pm," "the DP prefers text before 7am," "the catering company's owner answers but the assistant handles changes." Per-production and per-contact, scoped via `containerTag = production:<id>:contact:<id>`.

Pattern: every completed call writes structured outcome into `calls.structured_result` and a natural-language summary into Supermemory in the same transaction. The Supermemory write is fire-and-forget — if it fails, log and continue; the structured row is the source of truth.

### 3.3 Moss in-call index

Built once per production at intake, refreshed when documents change. Contents:

- Union rule fragments (SAG turnaround, IATSE meal penalties, child labor).
- Per-actor rider clauses, chunked.
- Per-location restrictions, chunked.
- Current call sheet, scene by scene.

This is what Gemini Live function-calls into mid-call. It is *not* a substitute for Postgres lookups — those are exact and fast — it's the thing the agent reaches for when the right answer is a fragment of unstructured text and the latency budget is brutal.

---

## 4. The agent loop

### 4.1 Tick

Cloud Scheduler POSTs `/api/tick/{productionId}` every 60 seconds. The endpoint is authenticated via OIDC (Scheduler can mint identity tokens for Cloud Run). The tick does five things, in order:

```ts
// src/lib/orchestrator/tick.ts
export async function runTick(productionId: string) {
  const ctx = await loadProductionContext(productionId);

  // 1. Pull fresh signals
  await pollWeatherIfStale(ctx);              // hourly debounce
  await pollSpongeWebhookBacklog(ctx);        // catch missed webhooks

  // 2. Recompute inferred fields
  recomputeProjectedWrap(ctx);
  recomputeTurnaroundWindows(ctx);
  recomputeConfirmationDeadlines(ctx);
  recomputeCumulativeSpend(ctx);

  // 3. Evaluate risks (deterministic)
  const currentRisks = evaluateRisks(ctx);

  // 4. Diff against open risks
  const openRisks = await db.select().from(risks)
    .where(and(eq(risks.productionId, productionId), isNull(risks.resolvedAt)));

  const { newRisks, resolvedRisks } = diffRisks(openRisks, currentRisks);

  // 5. Fire playbooks for new risks; close resolved
  for (const risk of newRisks) {
    await dispatchPlaybook(ctx, risk);
  }
  for (const risk of resolvedRisks) {
    await closeRisk(risk);
  }

  await flushEvents(ctx);
}
```

Target tick duration: <5s. If we approach the Cloud Run request timeout (15min, but we won't), the tick is doing too much and needs to be split.

### 4.2 Playbooks

A playbook is a TypeScript module exporting a single function:

```ts
// src/lib/playbooks/types.ts
export interface PlaybookContext {
  production: Production;
  risk: Risk;
  db: DrizzleClient;
  tools: ToolBelt;            // voice, sms, email, sponge, moss, supermemory
}

export interface PlaybookResult {
  resolved: boolean;
  events: EventInput[];
  followUpDeadline?: Date;
}

export type Playbook = (ctx: PlaybookContext) => Promise<PlaybookResult>;
```

Each playbook owns one risk kind and one response pattern. Playbooks compose tool calls (voice, SMS, email, payment, retrieval) but the *order* and *escalation logic* are code, not prompts.

**This is the most important architectural decision in the doc.** The agent's autonomy lives in the playbook code, not in a freeform agent loop. An LLM left to decide whether to call cast at 4am will sometimes decide wrong. A playbook that says "if weather risk > 0.5 and no cover set on file, call coordinator first" is debuggable and demoable. Inside a single call, Gemini Live is free-form: it talks, listens, decides whether to push back, extracts confirmation. Between calls, the orchestrator is structured.

Playbooks are registered in `src/lib/playbooks/registry.ts`:

```ts
export const PLAYBOOKS: Record<RiskKind, Playbook> = {
  weather: weatherCoverSet,
  turnaround: turnaroundViolation,
  silent_vendor: silentVendor,
  sick_cast: sickCastTriage,
  schedule_infeasible: multiDayReshuffle,
};
```

If `dispatchPlaybook` is called with a risk kind not in the registry, it escalates raw to the coordinator. We never synthesize a response we don't have a playbook for.

### 4.3 The tool belt

The orchestrator exposes a `ToolBelt` to every playbook. Each tool is a thin, typed wrapper around an external SDK with logging, idempotency, and error handling baked in:

```ts
// src/lib/tools/index.ts
export interface ToolBelt {
  voice: {
    call: (args: PlaceCallArgs) => Promise<CallResult>;
    callMany: (args: PlaceCallArgs[]) => Promise<CallResult[]>;  // parallel
  };
  sms: {
    send: (to: string, body: string) => Promise<void>;
    broadcast: (to: string[], body: string) => Promise<void>;
  };
  email: {
    send: (args: SendEmailArgs) => Promise<void>;
  };
  pay: {
    charge: (args: ChargeArgs) => Promise<ChargeResult>;
  };
  memory: {
    recall: (query: string, scope: MemoryScope) => Promise<MemoryHit[]>;
    record: (fact: string, scope: MemoryScope) => Promise<void>;
  };
  search: {
    rule: (query: string) => Promise<string>;          // Moss
    rider: (contactId: string, q: string) => Promise<string>;
  };
  callSheet: {
    regenerate: () => Promise<{ url: string; version: number }>;
  };
  escalate: (escalation: Escalation) => Promise<EscalationResponse>;
}
```

### 4.4 Mid-call function tools (what Gemini Live can call during a conversation)

When AgentPhone bridges a call to Gemini Live, we register a function-tool schema. These tools are called by the model mid-conversation, hit authenticated endpoints on our Cloud Run service, and return JSON the model uses to continue speaking.

```ts
// src/lib/voice/tool-schema.ts
export const IN_CALL_TOOLS = [
  {
    name: "get_scene",
    description: "Fetch full details for a scene by scene number.",
    parameters: {
      type: "object",
      properties: { scene_number: { type: "string" } },
      required: ["scene_number"],
    },
  },
  {
    name: "get_rider_clause",
    description: "Look up a specific rider clause for a contact. Use when the caller asks about contract terms.",
    parameters: {
      type: "object",
      properties: {
        contact_id: { type: "string" },
        topic: { type: "string", description: "e.g. 'travel', 'turnaround', 'meals'" },
      },
      required: ["contact_id", "topic"],
    },
  },
  {
    name: "get_union_rule",
    description: "Look up a SAG, IATSE, or other union rule. Use when verifying compliance.",
    parameters: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "check_alternate_call_time",
    description: "Check whether a proposed call time creates conflicts.",
    parameters: {
      type: "object",
      properties: {
        contact_id: { type: "string" },
        proposed_at: { type: "string", description: "ISO 8601" },
      },
      required: ["contact_id", "proposed_at"],
    },
  },
  {
    name: "record_confirmation",
    description: "Record that the caller confirmed (or declined) something.",
    parameters: {
      type: "object",
      properties: {
        contact_id: { type: "string" },
        scene_id: { type: "string" },
        confirmed: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["contact_id", "confirmed"],
    },
  },
  {
    name: "record_vendor_quote",
    description: "Record a price quote from a vendor, including any deposit required.",
    parameters: {
      type: "object",
      properties: {
        vendor_contact_id: { type: "string" },
        total_cents: { type: "integer" },
        deposit_cents: { type: "integer" },
        terms: { type: "string" },
      },
      required: ["vendor_contact_id", "total_cents"],
    },
  },
];
```

**Crucial design rule:** the agent on a call cannot directly mutate the schedule. It *records intent*. The orchestrator applies the mutation after the call ends and the playbook reads the structured outcome. This keeps a single writer to the schedule and makes "what changed because of this call" trivially auditable.

`record_vendor_quote` does not pay. Payment happens in the playbook *after* the call returns, gated by the tier engine (§5).

### 4.5 Confidence and escalation

Two escalation triggers, both code-enforced:

1. **Spend tier breach.** Any proposed action with cost above the tier ceiling escalates. The tier engine decides; the playbook doesn't get a vote.
2. **No matching playbook.** If the risk evaluator emits a risk kind without a registered playbook, escalate immediately with the raw risk and let the coordinator handle it. We do not synthesize a response.

Escalations land in the dashboard as a full-frame moment (brand brief §"Application"), mirrored as an SMS to the coordinator and an email to the line producer based on severity.

---

## 5. The Sponge integration in detail

### 5.1 Provisioning

At production intake, the platform creates a per-production agent:

```ts
// src/lib/sponge/provision.ts
import { SpongePlatform } from "@paysponge/sdk";

export async function provisionProductionWallet(production: Production) {
  const platform = await SpongePlatform.connect({
    apiKey: process.env.SPONGE_MASTER_KEY!,
  });

  const { agent, apiKey } = await platform.createAgent({
    name: `1ad-${production.id}`,
    description: `1ad agent for ${production.name}`,
    dailySpendingLimit: String(production.dailyCapCents / 100),
    weeklySpendingLimit: String(production.weeklyCapCents / 100),
  });

  // Store agentId in DB, apiKey in Secret Manager
  await db.update(productions)
    .set({ spongeAgentId: agent.id, spongeApiKey: secretRef(apiKey) })
    .where(eq(productions.id, production.id));

  return agent;
}
```

The agent API key is stored only in Secret Manager, never in Postgres directly. The DB column `sponge_api_key` holds the secret resource name (e.g. `projects/1ad/secrets/sponge-key-<prod>/versions/latest`), and the orchestrator loads it on demand.

### 5.2 Tier engine

```ts
// src/lib/sponge/tier.ts
export type Tier = "auto" | "notify" | "escalate";

export interface TierDecision {
  tier: Tier;
  reason: string;
  remainingDailyCents: number;
  remainingWeeklyCents: number;
}

export async function decideTier(
  production: Production,
  proposedAmountCents: number,
): Promise<TierDecision> {
  const { dailySpent, weeklySpent } = await getCumulativeSpend(production.id);
  const remainingDaily = production.dailyCapCents - dailySpent;
  const remainingWeekly = production.weeklyCapCents - weeklySpent;

  // Hard caps first
  if (proposedAmountCents > remainingDaily) {
    return { tier: "escalate", reason: "would_exceed_daily_cap", ... };
  }
  if (proposedAmountCents > remainingWeekly) {
    return { tier: "escalate", reason: "would_exceed_weekly_cap", ... };
  }

  // Per-transaction tier
  if (proposedAmountCents <= production.tierAutoCeiling) {
    return { tier: "auto", reason: "within_auto_ceiling", ... };
  }
  if (proposedAmountCents <= production.tierNotifyCeiling) {
    return { tier: "notify", reason: "within_notify_ceiling", ... };
  }
  return { tier: "escalate", reason: "exceeds_notify_ceiling", ... };
}
```

This is pure-function over inputs. It gets unit tests with every edge case in §10.

### 5.3 The pay tool

```ts
// src/lib/tools/pay.ts
export async function charge(args: ChargeArgs, ctx: PlaybookContext): Promise<ChargeResult> {
  const decision = await decideTier(ctx.production, args.amountCents);

  if (decision.tier === "escalate") {
    const response = await ctx.tools.escalate({
      kind: "spend_approval",
      amount: args.amountCents,
      merchant: args.merchant,
      reason: args.reason,
      tier_decision: decision,
    });
    if (!response.approved) {
      return { status: "blocked_by_escalation" };
    }
  }

  // Actually charge via Sponge
  const wallet = await getWallet(ctx.production);
  const result = await wallet.payWithCard({
    amount: String(args.amountCents / 100),
    merchant: args.merchantBindingOrFormUrl,
    // ... vendor-specific fields
  });

  // Record the transaction
  await db.insert(transactions).values({
    productionId: ctx.production.id,
    spongeTransactionId: result.id,
    amountCents: args.amountCents,
    merchant: args.merchant,
    category: args.category,
    tierUsed: decision.tier,
    status: result.status,
    playbookRunId: ctx.playbookRunId,
    contactId: args.contactId,
  });

  // Notify if tier requires it
  if (decision.tier === "notify") {
    await sendNotifyTierSms(ctx, result, args);
  }

  return { status: "charged", transactionId: result.id };
}
```

### 5.4 The "notify-and-pay" SMS

A real, sent SMS the line producer can act on. Template:

```
1ad: Just charged $400 (deposit) to Apex Camera Rental.
Reason: backup vendor for tomorrow — original vendor unreachable.
Daily remaining: $4,600 of $5,000.
Tap to undo: https://1ad.app/u/<token>
```

The undo link opens a one-tap web page that triggers a refund via Sponge. The token is single-use and expires in 24h. Beyond 24h the receipt is still visible in the dashboard but no longer one-tap reversible (a chargeback path remains).

### 5.5 Why we trust this in production

Sponge enforces `dailySpendingLimit` and `weeklySpendingLimit` server-side. Even if the orchestrator's tier engine is buggy and tries to charge over the cap, Sponge will reject the transaction. The application-layer tier engine exists for *good UX* — making the right call before hitting the wall — but the wall is real.

---

## 6. The five playbooks, in code-ready detail

Each playbook is a TypeScript module in `src/lib/playbooks/`. They share a common pattern: load context, decide actions, execute (often in parallel), record outcomes, return.

### 6.1 `weatherCoverSet` (Story 1: the 4am weather save)

**Trigger.** `evaluateRisks` emits `{kind: "weather", severity: "live"}` when: outdoor scene scheduled within 18h, precipitation probability > 0.5, no `is_cover_set=true` location linked.

**Shape:**

```ts
export const weatherCoverSet: Playbook = async (ctx) => {
  const { affectedScenes } = ctx.risk.context;

  // 1. Build cover-set options from past productions + current production's known locations
  const candidates = await suggestCoverSets(ctx, affectedScenes);

  // 2. Escalate to coordinator with options (this is the one decision we need)
  const choice = await ctx.tools.escalate({
    kind: "cover_set_choice",
    affectedScenes,
    candidates,
    deadline: addHours(new Date(), 1),
  });

  if (!choice.selected) return { resolved: false, events: [...] };

  // 3. Parallel cascade
  const [locResult, vendorResult, actorResult, _crewSms] = await Promise.all([
    ctx.tools.voice.call({
      to: choice.selected.ownerContactId,
      playbook: "weather_cover_set/confirm_location",
      dynamicVars: { locationName: choice.selected.name, ... },
    }),
    ctx.tools.voice.call({
      to: getEquipmentVendorId(ctx),
      playbook: "weather_cover_set/reroute_equipment",
      dynamicVars: { newAddress: choice.selected.address, newTime: ... },
    }),
    ctx.tools.voice.call({
      to: getLeadActorManagerId(ctx),
      playbook: "weather_cover_set/confirm_flex",
      dynamicVars: { ... },
    }),
    ctx.tools.sms.broadcast(getCrewPhones(ctx),
      `Location change: ${choice.selected.name} at ${formatTime(...)}. Full call sheet incoming.`),
  ]);

  // 4. Regenerate and distribute call sheet
  const sheet = await ctx.tools.callSheet.regenerate();
  await ctx.tools.email.send({
    to: getAllParties(ctx),
    subject: `Updated call sheet — ${ctx.production.name} day ${...}`,
    body: renderCallSheetEmail(sheet),
  });

  // 5. Summary to line producer
  await ctx.tools.email.send({
    to: getLineProducerEmail(ctx),
    subject: `Weather save — ${choice.selected.name}`,
    body: renderWeatherSaveSummary({ ... }),
  });

  return { resolved: true, events: [...] };
};
```

### 6.2 `sickCastTriage` (Story 2: the cascading sick day)

**Trigger.** Inbound SMS from coordinator parsed by `parseSmsIntent` into `{intent: "cast_unavailable", contactId, reason}`.

**Shape:** Find scenes that can shoot without the affected contact, verify other cast already confirmed, run turnaround check on the new ordering, propose, then parallel cascade calls (DP, props, catering, stand-in). Updated call sheet pushed.

### 6.3 `turnaroundViolation` (Story 3: the invisible union violation)

**Trigger.** Deterministic check inside `evaluateRisks`: for any SAG-affiliated contact, `nextCall.callAt - previousWrap < SAG_MINIMUM_HOURS (12)`. Runs every tick, including after every wrap event.

**Shape:** Compute the minimum delayed call time that satisfies turnaround, call each affected actor proposing the new call (Gemini Live), cascade to makeup/hair/transport, email line producer with the math and the dollar penalty avoided.

This email is the moneyshot for the demo. Make it beautiful. Template lives at `src/emails/turnaround-summary.tsx`, rendered with React Email.

### 6.4 `silentVendor` (Story 4: the silent vendor + autonomous payment)

**Trigger.** A `callTimes` row or vendor confirmation deadline passes without `confirmedAt`. The deadline is a Cloud Task scheduled at intake.

**Shape:**

```ts
export const silentVendor: Playbook = async (ctx) => {
  const vendor = await getContact(ctx.risk.context.vendorContactId);

  // 1. Try primary vendor, with retries
  const primaryResult = await ctx.tools.voice.call({
    to: vendor.phone!,
    playbook: "silent_vendor/check_in",
    retries: 2,
    retryDelayMs: 5 * 60_000,
  });

  if (primaryResult.outcome === "confirmed") {
    return { resolved: true, events: [...] };
  }

  // 2. Try backup contact
  if (vendor.notes /* has backup */) {
    const backupResult = await ctx.tools.voice.call({ ... });
    if (backupResult.outcome === "confirmed") return { resolved: true, ... };
  }

  // 3. Call top-N backup vendors in parallel, extract quotes
  const backups = await getBackupVendors(ctx, vendor.role);
  const quotes = await ctx.tools.voice.callMany(
    backups.map(b => ({
      to: b.phone!,
      playbook: "silent_vendor/request_quote",
      dynamicVars: { needBy: ..., specs: vendor.rider },
    }))
  );

  // 4. Pick best quote (lowest deposit that meets specs)
  const best = pickBestQuote(quotes);
  if (!best) {
    return await escalateNoBackup(ctx);
  }

  // 5. Charge the deposit (tier engine decides)
  const chargeResult = await ctx.tools.pay.charge({
    amountCents: best.deposit_cents,
    merchant: best.vendor.name,
    category: "equipment",
    contactId: best.vendor.id,
    reason: `Deposit for backup ${vendor.role} after original vendor unreachable`,
  });

  if (chargeResult.status !== "charged") {
    return await escalateChargeFailed(ctx, chargeResult);
  }

  // 6. Confirm with backup vendor (now that deposit is paid)
  await ctx.tools.voice.call({
    to: best.vendor.phone!,
    playbook: "silent_vendor/confirm_booking_paid",
    dynamicVars: { transactionId: chargeResult.transactionId },
  });

  // 7. Update schedule
  await replaceVendor(ctx, vendor.id, best.vendor.id);

  // 8. Notify coordinator (SMS)
  await ctx.tools.sms.send(getCoordinatorPhone(ctx),
    `Backup ${vendor.role} secured: ${best.vendor.name}. $${best.deposit_cents/100} deposit charged, $${(best.total_cents - best.deposit_cents)/100} due on delivery.`);

  // 9. If the remaining balance crosses notify-tier, pre-notify line producer
  const balanceCents = best.total_cents - best.deposit_cents;
  if (balanceCents > ctx.production.tierAutoCeiling) {
    await preNotifyLineProducer(ctx, best, balanceCents);
  }

  return { resolved: true, events: [...] };
};
```

**The demo moment:** the agent decides to pay $400 (auto tier), pays it, and only *then* surfaces — by SMS — that the larger $1,400 balance will land tomorrow under notify tier. The line producer learns about the entire incident at the same moment they learn it's already resolved. That's the pitch.

### 6.5 `multiDayReshuffle` (Story 5: the multi-day reshuffle)

**Trigger.** Manual — coordinator marks a location unavailable via the dashboard. Fires `dispatchPlaybook` with kind `schedule_infeasible`.

**Shape:** Gather constraints (remaining scenes, cast availability, weather, equipment windows, turnaround), pose to Gemini 2.5 Pro as an optimization problem with structured output, validate each proposal against a deterministic feasibility checker, present the top 3 viable proposals to the coordinator. On selection: generate the call list (typically 20+ contacts), confirm via parallel Gemini Live calls, track progress in the dashboard.

This is the only playbook that uses an LLM for the *decision*, not just for the conversation. Reasonable because the search space is too combinatorial for hand-rolled rules in a hackathon window. Mitigation against LLM-proposed infeasible plans: the feasibility checker filters and re-prompts.

---

## 7. Voice call mechanics

### 7.1 Lifecycle

```
Orchestrator              AgentPhone              Gemini Live
     │                        │                        │
     │ startCall({to,         │                        │
     │   systemPrompt,        │                        │
     │   tools, dynVars})     │                        │
     ├───────────────────────►│                        │
     │                        │ dial, bridge ─────────►│
     │                        │                        │
     │◄── webhook call.started┤                        │
     │                        │                        │
     │                        │   audio ◄──►           │
     │                        │   tool_call ─────────► │
     │                        │  /api/tools/<name>     │
     │                        │   tool_response ◄──────│
     │                        │                        │
     │◄── webhook call.ended ─┤                        │
     │     {transcript,       │                        │
     │      structuredResult} │                        │
     │                        │                        │
     │ persist call;          │                        │
     │ resume playbook;       │                        │
     │ write Supermemory      │                        │
```

### 7.2 The agent's voice (per brand brief §"Voice")

System prompt template lives at `src/lib/voice/prompts/base.txt`. Interpolated per playbook with dynamic variables:

```
You are 1ad — a digital First Assistant Director calling on behalf of {{production_name}}.

Speak the way an experienced 1st AD speaks: short, declarative, set-literate, no apologies, no hedging.

Use production vocabulary correctly: turnaround, cover set, one-liner, stripboard, lockup, martini, sides, second team.

Open with the reason for the call in one sentence. Examples:
- "Quick one — we need to move your call to 9:45 tomorrow to clear turnaround. Confirming?"
- "Calling about the truck for tomorrow's load-in. Can you give me an ETA?"

Never volunteer that you are an AI unless the caller asks directly. If asked, answer honestly and briefly, then return to the task.

Current task: {{task_description}}
Caller: {{contact_name}} ({{contact_role}})
Deadline: {{deadline}}

Tools available:
{{tool_descriptions}}

When the caller confirms or declines, call record_confirmation immediately. Do not wait until the end of the call. If they give a vendor quote, call record_vendor_quote immediately. End the call when the task is done.
```

### 7.3 In-call retrieval latency

Target end-to-end latency from question asked to TTS resuming after a tool call: <200ms. Moss claims sub-10ms for retrieval, AgentPhone adds network, our handler adds DB. We measure with synthetic test calls on day 1 and treat anything over 300ms as a bug.

The handler endpoint:

```ts
// src/app/api/tools/get_union_rule/route.ts
export async function POST(req: Request) {
  const { query, production_id } = await req.json();
  await verifyAgentPhoneJwt(req);                         // shared-secret auth

  const hits = await moss.query({
    indexId: getMossIndexId(production_id),
    query,
    topK: 3,
  });

  return Response.json({
    result: hits.map(h => h.text).join("\n\n"),
  });
}
```

### 7.4 SMS

Two patterns, both via AgentPhone:

- **Broadcast.** Crew location change, schedule update. One template, parallel sends, no inbound expected.
- **Conversational.** Coordinator updates, vendor self-reports. Inbound SMS hits a webhook, gets parsed by a small Gemini structured-output prompt into `{intent, entities}`, routed to a playbook or held for human review.

```ts
// src/app/api/hook/agentphone/sms/route.ts
export async function POST(req: Request) {
  const payload = await verifyAndParse(req);
  const intent = await parseSmsIntent(payload.body, payload.from);

  switch (intent.kind) {
    case "cast_unavailable":
      return dispatchPlaybook(intent.productionId, {
        kind: "sick_cast",
        context: intent,
      });
    case "scene_wrapped":
      return recordSceneWrap(intent);
    case "unclear":
      return notifyCoordinator(intent);
  }
}
```

---

## 8. Email

### 8.1 AgentMail per-production inbox

At production creation, provision an inbox:

```ts
// src/lib/email/provision.ts
import { AgentMailClient } from "agentmail";

export async function provisionInbox(production: Production) {
  const am = new AgentMailClient({ apiKey: process.env.AGENTMAIL_API_KEY! });

  const inbox = await am.inboxes.create({
    username: `1ad-${slugify(production.name)}`,
    clientId: `1ad-prod-${production.id}`,         // idempotent
  });

  await am.webhooks.create({
    url: `${process.env.APP_URL}/api/hook/agentmail`,
    eventTypes: ["message.received", "message.bounced"],
    clientId: `1ad-prod-${production.id}-hook`,
  });

  await db.update(productions)
    .set({ agentmailInbox: inbox.email })
    .where(eq(productions.id, production.id));
}
```

This gives the agent a real email identity like `1ad-acme-commercial@agentmail.to`. Replies from vendors, line producers, and managers come back into the same inbox and are parsed.

### 8.2 Templates

React Email for everything. Templates live in `src/emails/`:

- `turnaround-summary.tsx` — the Story 3 moneyshot
- `weather-save-summary.tsx` — Story 1
- `cover-set-options.tsx` — escalation with options
- `notify-tier-receipt.tsx` — mirrors the SMS but with full transaction detail
- `daily-summary.tsx` — end-of-day digest including all auto-tier spend
- `updated-call-sheet.tsx` — wrapper around the PDF link

Visual treatment follows the brand brief: Fraunces in HTML where the client supports it (with a graceful fallback to Georgia), monospace data tables, hairline rules, no card stacks, no shadows.

---

## 9. Call sheet generation

Two output formats:

- **PDF** for human distribution. Rendered server-side with `@react-pdf/renderer` from a React component that mirrors the brand brief (Fraunces for scene names, JetBrains Mono for times, stripboard edges, hairline rules). Stored in Cloud Storage; signed URLs in emails.
- **JSON** for API consumers and the dashboard.

Generation is triggered on any schedule mutation. Versioned: every regeneration creates a new file with an incrementing version number. Emails always link to the versioned URL so they don't become stale.

```ts
// src/lib/call-sheet/generate.ts
export async function generateCallSheet(productionId: string, shootDay: number) {
  const data = await loadCallSheetData(productionId, shootDay);
  const buffer = await renderToBuffer(<CallSheet data={data} />);

  const version = await nextVersion(productionId, shootDay);
  const objectName = `call-sheets/${productionId}/day-${shootDay}-v${version}.pdf`;

  await storage.bucket(BUCKET).file(objectName).save(buffer);
  const [url] = await storage.bucket(BUCKET).file(objectName).getSignedUrl({
    action: "read",
    expires: addDays(new Date(), 7),
  });

  return { url, version };
}
```

---

## 10. Dashboard

The dashboard is not an admin panel. It is the product surface the coordinator and line producer experience day-to-day, and the brand brief is specific enough that getting it visually right is a competitive advantage in the demo. This section is long because it deserves to be.

### 10.1 Design tokens (Tailwind v4 theme)

```css
/* src/app/globals.css */
@import "tailwindcss";

@theme {
  /* Foundation */
  --color-stage-black: #0C0D0F;
  --color-console-graphite: #16181B;
  --color-slate-gray: #21242A;
  --color-chalk-white: #E6E4DC;

  /* Stripboard */
  --color-sunlight: #E8C547;
  --color-tungsten: #4A90C2;
  --color-bone: #D4D2C8;
  --color-soundstage: #6B8E5A;

  /* Signal */
  --color-tally: #D94A3D;

  /* Type */
  --font-serif: "Fraunces", Georgia, serif;
  --font-mono: "JetBrains Mono", "Berkeley Mono", ui-monospace, monospace;

  /* Rhythm */
  --hairline: 0.5px;
}

body {
  background: var(--color-stage-black);
  color: var(--color-chalk-white);
  font-family: var(--font-serif);
  font-feature-settings: "ss01", "ss02";
}

.rule { border-top: var(--hairline) solid var(--color-slate-gray); }
.rule-vertical { border-left: var(--hairline) solid var(--color-slate-gray); }

.caption {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-slate-gray);    /* dimmer than body */
}
```

Fonts loaded from Google Fonts in `app/layout.tsx` via `next/font` with `display: "swap"` and `optical-sizing: "auto"` for Fraunces.

### 10.2 Component library (the irreducible set)

Eight components carry the whole product. Built once, used everywhere.

```
src/components/
  StripboardRow.tsx       — colored-edge row with scene/contact info
  HeroMetric.tsx          — large mono number with caption
  HairlineRule.tsx        — horizontal or vertical
  Waveform.tsx            — tungsten waveform, breathing
  TallyDot.tsx            — small red dot for live signals
  Letterbox.tsx           — full-frame escalation surface wrapper
  RollingNumber.tsx       — mono number that ticks (not spins) on update
  Caption.tsx             — tracked-uppercase mono label
```

#### 10.2.1 StripboardRow

The most-used pattern in the product. A 4px colored left edge classifies the row at a glance.

```tsx
// src/components/StripboardRow.tsx
type EdgeColor = "sunlight" | "tungsten" | "bone" | "soundstage" | "tally";

export function StripboardRow({
  edge, title, caption, right, onClick,
}: {
  edge: EdgeColor;
  title: ReactNode;
  caption?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="grid grid-cols-[4px_1fr_auto] items-center gap-4 py-4 px-6 hover:bg-console-graphite/40 transition-colors"
      style={{ borderBottom: "var(--hairline) solid var(--color-slate-gray)" }}
    >
      <div className="h-full" style={{ background: `var(--color-${edge})` }} />
      <div>
        <div className="font-serif text-[15px]">{title}</div>
        {caption && <div className="caption mt-1">{caption}</div>}
      </div>
      {right && <div className="font-mono text-[13px]">{right}</div>}
    </div>
  );
}
```

Usage:

```tsx
<StripboardRow
  edge="sunlight"                      // day exterior
  title="14A — Beach establishing"
  caption="Day 02 · Loc: Stinson · Cast: 3"
  right="06:00 → 09:30"
/>
```

#### 10.2.2 HeroMetric

```tsx
<HeroMetric
  label="Projected wrap"
  value="19:42"
  delta="+12m"                         // optional, tally if negative
/>
```

Renders 36px JetBrains Mono, tracked tight (`-0.02em`), with a 10px caption above. No card, no border. Just the number occupying the room it deserves.

#### 10.2.3 Waveform

The agent's voice presence. Thin tungsten waveform that breathes with the actual cadence of speech (driven by audio-level events from AgentPhone webhooks). When the agent stops, the waveform settles flat — it does *not* loop or pulse on idle.

Implementation: SVG path with a `requestAnimationFrame` loop reading from a level queue. ~30 lines of code; the discipline is in *not* over-animating it.

#### 10.2.4 Letterbox

```tsx
<Letterbox>
  <Escalation
    decision="Cover set for tomorrow's beach scenes?"
    options={[
      { label: "Stinson community hall", caption: "12 min from base · $850/day" },
      { label: "Sausalito interior studio", caption: "28 min from base · $1,200/day" },
      { label: "Push by one day", caption: "Cascades into day 3 turnaround" },
    ]}
    deadline="06:00"
  />
</Letterbox>
```

`<Letterbox>` renders 2.35:1 black bars top and bottom, content centered. No second screen, no nested confirmation, no "are you sure." The brief is explicit: the line producer is busy, the agent has already done the thinking.

### 10.3 Pages

```
src/app/
  layout.tsx                        — root layout (fonts, theme)
  (dashboard)/
    page.tsx                        — today view (default)
    schedule/page.tsx               — full stripboard, all days
    calls/page.tsx                  — call log + live calls
    spend/page.tsx                  — transaction ledger + tier audit
    intake/page.tsx                 — production setup wizard
  escalations/[id]/page.tsx         — full-frame letterbox
  api/                              — webhooks, tick, tools (covered above)
```

#### 10.3.1 Today view (the home screen)

The page the coordinator lives in. Anatomy top to bottom:

```
┌─────────────────────────────────────────────────────────────┐
│  1ad   ·   ACME COMMERCIAL DAY 02 / 03   ·   ●  14:23:07   │   ← Header
├─────────────────────────────────────────────────────────────┤   ← hairline
│                                                              │
│   PROJECTED WRAP                              CALLS TODAY    │
│   19:42                                       7 / 12         │   ← Hero strip
│   +12m on plan                                3 outstanding  │
│                                                              │
├─────────────────────────────────────────────────────────────┤   ← hairline
│                                                              │
│  ▌ 14A — Beach establishing      06:00 → 09:30  ✓ WRAPPED    │
│  ▌ 14B — Wide on couple          09:45 → 11:15  ● ROLLING    │   ← Stripboard
│  ▌ 14C — Reverse                 11:30 → 13:00  · planned    │
│  ▌ 22 — Hotel lobby (cover)      14:30 → 18:00  · planned    │
│  ▌ 22A — Lobby insert            18:15 → 19:30  · planned    │
│                                                              │
├─────────────────────────────────────────────────────────────┤   ← hairline
│                                                              │
│  AGENT ACTIVITY                                              │
│  ◢◣◢◣◢◣◢◣                                                    │   ← Waveform
│  Calling David Park (DP)  ·  Re: lens kit for 14B  ·  0:42   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

The header `1ad` is set in Fraunces italic, 26px. The day counter and timecode are JetBrains Mono caption style. The live dot is `tungsten` when the agent is doing something, `tally` when something needs the line producer.

#### 10.3.2 Spend view

Specifically called out because Sponge integration deserves a first-class surface. The ledger shows every transaction the agent has made, with tier badges, running daily and weekly remaining, and a one-click filter by tier.

```
DAILY SPEND                                    $1,847 / $5,000
WEEKLY SPEND                                   $8,420 / $20,000

▌ APEX CAMERA RENTAL          $400.00  AUTO     14:23  ●
   Deposit · backup vendor (Cinema Pro unreachable)

▌ STARBUCKS — UNION SQ         $87.40  AUTO     08:11  ✓
   Crew morning coffee · authorized by SOP

▌ ENTERPRISE CARGO VAN        $245.00  AUTO     07:02  ✓
   Day rental · transport coordinator request

▌ APEX CAMERA RENTAL        $1,400.00  NOTIFY   17:30  ⚠
   Balance due on delivery (companion to deposit above)
   Line producer SMS'd · undo expires 17:30 tomorrow
```

Each row uses `StripboardRow` with edge color matching tier (`bone` for auto, `tungsten` for notify, `tally` for escalate). The audit trail underneath each entry expands to show the original playbook decision and the tier engine's reasoning. This is for the line producer — they want to be able to ask "why did you pay this" and get an answer in two clicks.

### 10.4 Live updates

The dashboard subscribes to an SSE stream:

```ts
// src/app/api/events/stream/route.ts
export async function GET(req: Request) {
  const productionId = new URL(req.url).searchParams.get("p")!;

  const stream = new ReadableStream({
    async start(controller) {
      const subscription = subscribeToEvents(productionId, (event) => {
        controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
      });

      req.signal.addEventListener("abort", () => {
        subscription.unsubscribe();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
    },
  });
}
```

`subscribeToEvents` is backed by Postgres `LISTEN/NOTIFY` — when any code inserts into `events`, a trigger NOTIFYs and any open SSE connections fan out. No Redis, no extra infra. For the hackathon scale (single production at a time during the demo) this is plenty.

Client-side, a small React hook:

```tsx
function useEventStream(productionId: string) {
  const [events, setEvents] = useState<Event[]>([]);
  useEffect(() => {
    const es = new EventSource(`/api/events/stream?p=${productionId}`);
    es.onmessage = (e) => setEvents(prev => [JSON.parse(e.data), ...prev].slice(0, 200));
    return () => es.close();
  }, [productionId]);
  return events;
}
```

### 10.5 Motion

Three modes from the brand brief, applied via Tailwind utilities and CSS custom properties:

- **Cut (0ms).** Confirmations locking in, escalations landing, scene status flips. No transition.
- **Dissolve (700ms).** Schedule rebuilds, view changes. `transition: opacity 700ms ease-in-out`.
- **Roll.** Recalculating numbers (projected wrap, budget). The `RollingNumber` component splits the digits and animates each digit row vertically, snapping into place. Never spins, never fades.

Nothing bounces. Nothing pops. Everything settles the way a slate settles after the clap.

---

## 11. Repository layout

```
1ad/
├── src/
│   ├── app/
│   │   ├── (dashboard)/            # dashboard pages
│   │   ├── escalations/
│   │   ├── api/
│   │   │   ├── hook/               # webhooks: agentphone, agentmail, sponge
│   │   │   ├── tools/              # mid-call function tools
│   │   │   ├── tick/               # scheduled tick endpoint
│   │   │   ├── poll/               # weather, deadlines
│   │   │   └── events/stream/      # SSE
│   │   ├── globals.css
│   │   └── layout.tsx
│   ├── components/                 # shared UI
│   ├── db/
│   │   ├── schema.ts               # Drizzle
│   │   ├── migrations/
│   │   └── client.ts
│   ├── lib/
│   │   ├── orchestrator/           # tick, risk evaluator, dispatcher
│   │   ├── playbooks/              # one file per playbook
│   │   ├── tools/                  # voice, sms, email, pay, memory, search
│   │   ├── voice/                  # Gemini Live config, prompt templates
│   │   ├── sponge/                 # provision, tier engine, wallet
│   │   ├── email/                  # AgentMail wrappers
│   │   ├── memory/                 # Supermemory + Moss wrappers
│   │   └── call-sheet/             # PDF generation
│   └── emails/                     # React Email templates
├── drizzle.config.ts
├── next.config.ts
├── package.json
├── Dockerfile
└── infra/
    ├── cloud-run.yaml
    ├── cloud-scheduler.yaml
    └── secrets.tf                  # optional Terraform for secrets
```

---

## 12. Deployment on Google Cloud

### 12.1 Services to provision

| GCP service | Purpose | Notes |
|---|---|---|
| Cloud Run | hosts `1ad-app` | Single service, min instances=1 to avoid cold start during demo |
| Cloud SQL (Postgres 16) | primary DB | Smallest tier is plenty; enable Cloud SQL Auth Proxy sidecar |
| Cloud Storage | call sheet PDFs, upload bucket | Lifecycle: delete after 30d on uploads bucket |
| Cloud Scheduler | tick + weather + deadline cron | 3 jobs, all hit Cloud Run with OIDC |
| Cloud Tasks | deadline timers (vendor confirm by 6pm) | Per-production task queues |
| Secret Manager | API keys: Sponge master, AgentPhone, AgentMail, Gemini, Moss, Supermemory | Mounted as env vars on Cloud Run via `--set-secrets` |
| Cloud Logging | structured logs from app | Default; no extra setup |
| Artifact Registry | container images | One repo, one image |

### 12.2 Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 8080
ENV PORT=8080
CMD ["node", "server.js"]
```

`next.config.ts` must set `output: "standalone"` for this to work.

### 12.3 Deploy command

```bash
gcloud run deploy 1ad-app \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 4 \
  --cpu 2 --memory 2Gi \
  --add-cloudsql-instances $PROJECT:us-central1:1ad-db \
  --set-env-vars NODE_ENV=production,APP_URL=https://1ad.app \
  --set-secrets DATABASE_URL=db-url:latest,\
SPONGE_MASTER_KEY=sponge-master:latest,\
AGENTPHONE_API_KEY=agentphone:latest,\
AGENTMAIL_API_KEY=agentmail:latest,\
GEMINI_API_KEY=gemini:latest,\
MOSS_PROJECT_KEY=moss:latest,\
SUPERMEMORY_API_KEY=supermemory:latest
```

### 12.4 Authentication boundaries

- **Public.** Dashboard pages, webhook receivers (verified by signature, not IAM).
- **OIDC-only.** Tick and poll endpoints, called by Cloud Scheduler with `--oidc-service-account-email`.
- **Shared-secret (HMAC).** Mid-call tool endpoints, called by AgentPhone with a header signed by a key shared at AgentPhone agent setup time.

### 12.5 Local development

```bash
docker compose up -d                          # local postgres
npm run db:push                               # apply Drizzle schema
npm run dev                                   # next dev on :3000
ngrok http 3000                               # for webhook testing
```

Webhook URLs are configured to point at the ngrok URL during development. Switch to the Cloud Run URL for any cloud-side test.

---

## 13. Build order (the actual day-by-day plan)

A hackathon week, roughly:

**Day 1 — foundations.**
- Repo, Next.js scaffold, Tailwind theme with brand tokens, Cloud SQL + Drizzle schema.
- Provision AgentPhone number, AgentMail inbox, Sponge agent for one test production.
- Hardcoded seed data for ACME Commercial Day 02.
- Today view renders with stripboard rows from real DB data.

**Day 2 — voice + tools.**
- Gemini Live + AgentPhone bridge working end-to-end.
- Mid-call tool endpoints for `get_scene`, `record_confirmation`, `record_vendor_quote`.
- One playbook end-to-end: `turnaroundViolation` (Story 3). Lowest infrastructure surface, highest demo value, easiest to test deterministically.

**Day 3 — Sponge + Story 4.**
- Tier engine with unit tests.
- `silentVendor` playbook with real Sponge card charge against a test merchant.
- Spend view in dashboard.
- Notify-tier SMS with working undo link.

**Day 4 — weather + sick day.**
- `weatherCoverSet` (Story 1) and `sickCastTriage` (Story 2).
- Call sheet PDF generation.
- Email templates polished (especially turnaround summary).

**Day 5 — reshuffle + polish.**
- `multiDayReshuffle` (Story 5) with the Gemini 2.5 Pro optimization step.
- Waveform component refined.
- Letterbox escalation page polished.
- End-to-end run of all five scenarios.

**Day 6 — demo prep.**
- Scripted demo data so all five scenarios trigger reliably.
- Backup plan for each demo if a live API misbehaves (canned responses behind a feature flag).
- Practice runs.

---

## 14. What's not built

Documented so it's clear what we cut and why:

- **Auth.** No login for the hackathon. Single production, single dashboard, demo-only.
- **Multi-tenant.** One production at a time. The schema supports many; the orchestrator's tick loop assumes one.
- **Mobile app.** Dashboard is responsive but optimized for desktop. The brand brief reads better there.
- **iOS/Android push notifications.** SMS covers the urgent path. Push is v2.
- **Webhook signature verification on all paths.** Implemented for Sponge and AgentMail. AgentPhone signing is implemented; manual override for local dev.
- **Real-time GPS, accounting integration, editorial integration.** Explicitly out of scope per PRD §7.6.

---

## 15. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Gemini Live latency spikes mid-call | Medium | Pre-warm the model session at call start; fall back to canned response if a tool call exceeds 1s. |
| AgentPhone webhook drops a call.ended | Low | Tick reconciles by polling AgentPhone for any call started >5min ago without a recorded end. |
| Sponge card declined at test merchant | Medium | Have a known-good test merchant pre-wired; surface the decline in the dashboard with a clean error state. |
| Cloud SQL cold start during demo | Low | `min-instances 1` on Cloud Run; SQL is always-on. |
| LLM proposes infeasible reshuffle (Story 5) | High | Deterministic feasibility checker filters and re-prompts up to 3 times before falling back to "no viable proposal — escalating." |
| Coordinator's intake conversation hits an unhandled edge case | Medium | Intake is the most freeform part; have a manual fallback dashboard form to enter anything the voice intake missed. |
| AgentPhone or Sponge sandbox quotas exhausted mid-demo | Medium | Pre-provision and warm-cache; have a second account ready as failover. |

---

## 16. Success criteria

From the PRD's §10.1, restated as concrete observable outcomes:

1. All five scenarios run end-to-end in a single 10-minute demo with no manual intervention beyond the documented coordinator inputs.
2. Story 4 results in a real Sponge card charge against a test merchant, visible in the dashboard and the Sponge console within 5 seconds of the charge clearing.
3. The agent's reasoning is visible in the dashboard event feed at every step — including the tier check, the playbook decision, and the spend rationale.
4. The dashboard is visually faithful to the brand brief — judged against the brief, not against generic dashboard taste.
5. The agent voice in calls sounds like a 1st AD, not a chatbot. Tested by playing call recordings to someone who has worked on a set and asking whether they'd notice it was AI without being told.