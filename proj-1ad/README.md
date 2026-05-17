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
