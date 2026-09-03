import "dotenv/config";
import { defineConfig } from "prisma/config";

// `datasource` is only consulted by migration / introspection commands (`prisma
// migrate`, `prisma db ...`). `prisma generate` needs no database connection, so
// resolve the URL leniently instead of `env("DATABASE_URL")` (which throws when
// the var is absent) — otherwise `postinstall: prisma generate` fails on Vercel's
// `npm install` step, which runs without the build-time env vars.
const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
