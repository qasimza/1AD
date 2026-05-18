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

### Force-end stuck active calls

AgentPhone only allows **one active call per phone number** — a stray
robocall to your public number, or a hosted-mode call that didn't time out,
will block new outbound dials with `409 Conflict`. This script lists every
in-progress call and force-ends each via `POST /v1/calls/{id}/end`.

```bash
npx tsx --env-file=.env.local scripts/end-active-calls.ts
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
`systemPrompt` is sent.

```bash
npx tsx --env-file=.env.local scripts/test-webhook-call.ts
```

You should hear the greeting, say something, and hear the agent echo it
back. The `next dev` log shows `[agentphone-hook]` entries for each turn
and a final `call_ended` event.
