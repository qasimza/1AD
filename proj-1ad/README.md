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
