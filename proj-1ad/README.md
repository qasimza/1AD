# 1ad

Hackathon build of the 1ad orchestrator — Next.js 15 + Drizzle + Postgres.
See [../docs/TDD.md](../docs/TDD.md) for the full design spec.

## Prerequisites

- Node 22+
- A `.env` (or `.env.local`) with `DATABASE_URL` and service keys. See
  the existing `.env` for the full list.

## Develop

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Database

### Seed (or reseed) the dev database

Wipes and repopulates the ACME Commercial demo production.

```bash
npx tsx --env-file=.env src/db/seed.ts
```

Run this any time you change `src/db/seed.ts` or want a clean slate.

### Apply schema changes

```bash
npx drizzle-kit push
```

If `drizzle-kit push` crashes during schema introspection (known bug with
Supabase internal CHECK constraints), add the missing column in the
**Supabase dashboard → Table Editor**, or paste the equivalent
`ALTER TABLE ...` into the **SQL Editor**.

## AgentPhone

### Inspect the AgentPhone project

Prints every agent, every number (with ids), and the current project +
per-agent webhook configuration. Use this to grab the right ids for
`AGENTPHONE_AGENT_ID`, `AGENTPHONE_NUMBER_ID`, and `AGENTPHONE_NUMBER` in
your env file, or to confirm a webhook is registered.

```bash
npx tsx --env-file=.env.local scripts/show-agentphone-config.ts
```

### Outbound call smoke test (hosted mode)

Places one hosted-mode call to the first `lead_cast` contact in the seed.
Used to verify `AGENTPHONE_API_KEY`, `AGENTPHONE_AGENT_ID`, and the outbound
flow before the webhook receiver is online.

```bash
npx tsx --env-file=.env.local scripts/test-place-call.ts
```

### Step-by-step call debug

When an outbound call 400s with a confusing error (e.g. "Agent has no phone
number assigned" even though it does), this walks through env, agent state,
number state, per-agent webhook, the exact request body, and the raw
response — so you can see exactly where AgentPhone disagrees with you.

```bash
npx tsx --env-file=.env.local scripts/debug-agentphone-call.ts
```

### Webhook loop (local dev)

In webhook mode, AgentPhone POSTs every voice turn to a public HTTPS URL
and waits for an NDJSON reply. Local `next dev` isn't reachable from
AgentPhone's servers, so we expose it through ngrok and point the agent
at the tunnel.

```bash
# terminal A — local app
npm run dev

# terminal B — public tunnel to :3000
ngrok http 3000

# terminal C — point the agent at the tunnel
WEBHOOK_BASE_URL=https://<your-id>.ngrok-free.app \
  npx tsx --env-file=.env.local scripts/configure-agentphone-webhook.ts
```

The script PATCHes `POST /v1/agents/<agent>/webhook` and prints a fresh
signing secret — AgentPhone rotates it on every upsert. Save it as
`AGENTPHONE_WEBHOOK_SECRET` in `.env.local`. Pass `--delete` to remove
the agent webhook entirely.

Re-run the configurator any time ngrok hands you a new subdomain. While
the receiver is just an echo (`/api/hook/agentphone`), you can sanity-
check the route with:

```bash
curl https://<your-id>.ngrok-free.app/api/hook/agentphone
# → {"ok":true,"route":"/api/hook/agentphone",…}
```

### Outbound call smoke test (webhook mode)

Places one **webhook-mode** call so AgentPhone delegates every user turn
to `/api/hook/agentphone`. Same target as the hosted-mode test, but no
`systemPrompt` is sent — and `productionId` + `contactId` are passed in
so the call is persisted to the `calls` table.

```bash
npx tsx --env-file=.env.local scripts/test-webhook-call.ts
```

You should hear the greeting, talk naturally to One A.D., and watch the
agent actually invoke tools to look up the call time, confirm
attendance, and hang up cleanly when it's done. The `next dev` log
shows `[agentphone-hook] agent ok in <ms> tools=[...]` for each turn
and a final `call_ended` write (emitted as `call.completed`).

### Inspect persisted calls

Prints the last 10 rows in `calls` joined to `contacts` — verify lifecycle
persistence is landing rows with the right `outcome`, transcript, and
timestamps.

```bash
npx tsx --env-file=.env.local scripts/show-calls.ts
```

## In-call agent

The voice webhook routes every user turn through the **OpenAI Agents
SDK** (`@openai/agents`). The agent (`src/lib/agent/one-ad.ts`):

- runs an autonomous tool-calling loop per turn (max 4 inner steps),
- chains conversation state via `previousResponseId` — no manual chat-
  history bookkeeping, no replay,
- has 5 function tools wired against Postgres:
  - `get_call_time` — look up the contact's next call time
  - `get_scene_details` — fetch scenes for the next shoot day
  - `record_confirmation` — write `call_times.confirmed_at`
  - `record_conflict` — open a `risks` row for human follow-up; captures an optional `proposedCallAt` (ISO-8601) and `proposedReason` when the contact offers an alternative
  - `end_call` — signal hang-up after the next spoken sentence
- Post-call recap SMS (`src/lib/voice/summary.ts`): when the `call_ended` webhook fires, the saved transcript is summarised by `gpt-5.4-mini` into a 1-3 sentence text and shipped to the contact via AgentPhone (`POST /v1/messages`). Persisted to the local `messages` table; emits a `sms.sent` event. Skipped silently for voicemail/no-answer/empty-transcript calls, or when the summariser returns `SKIP`.
    (the webhook then fires `POST /v1/calls/{id}/end` once TTS has
    flushed the goodbye)

Default model is `gpt-5.4-mini` (sub-second per inner step, mature
function-calling). Configure via `.env.local`:

```
OPENAI_API_KEY=sk-…
LLM_MODEL=gpt-5.4-mini   # optional override
```

### Smoke test the agent

Runs the agent against the real database with a synthetic call row —
no phone, no AgentPhone. Confirms the API key, model availability,
SDK wiring, and that tools can actually read and write the seed data
before you burn AgentPhone minutes.

```bash
npx tsx --env-file=.env.local scripts/test-agent.ts
```

Expect the agent to invoke `get_call_time` (visible in the
`tools called:` array) and produce a one-or-two sentence reply
referencing your seeded production + contact. Override the user line
with `AGENT_TEST_USER_TURN="..."` to probe specific tools.
