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
} satisfies Config;