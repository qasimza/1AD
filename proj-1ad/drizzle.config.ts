import type { Config } from "drizzle-kit";
import { config } from "dotenv";

// drizzle-kit does not always inherit Next.js env loading behavior.
config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Add it to .env.local or .env before running drizzle-kit."
  );
}

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Supabase ships internal CHECK constraints in `auth`, `storage`, `realtime`,
  // etc. whose `check_clause` is NULL in information_schema. drizzle-kit's
  // introspector crashes on those. Restrict to the public schema we own.
  schemaFilter: ["public"],
} satisfies Config;