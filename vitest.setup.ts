// Ensures `.env` is loaded inside each vitest worker (not just the CLI
// launcher process) — needed for DB-touching integration tests (e.g.
// prop-firms.service.test.ts) whose Prisma client reads `DATABASE_URL` from
// `process.env` at import time. Mirrors prisma.config.ts's own `dotenv/config`.
import "dotenv/config";
