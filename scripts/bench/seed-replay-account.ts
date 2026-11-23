/**
 * Seeds a demo user + Strategy Lab account (60 days of EURUSD M1, clock 30
 * days in) into the TEST database, for the browser replay benchmark.
 * Run: set -a; . ./.env.test; set +a; npx tsx scripts/bench/seed-replay-account.ts
 */
import bcrypt from "bcryptjs";

import { prisma } from "@/server/db";
import { importHistoricalDataset } from "@/server/services/native-replay/historical-dataset.service";
import { syntheticMt5Export } from "@/domain/native-replay/testing/m1-fixtures";
import { createLabAccount, startSimClock } from "@/server/services/simulation/sim-account.service";
import { advanceSimClock } from "@/server/services/simulation/sim-clock.service";

async function main() {
  const email = "replay-bench@example.test";
  await prisma.user.deleteMany({ where: { email } });
  const user = await prisma.user.create({ data: { email, name: "Replay bench", hashedPassword: await bcrypt.hash("bench-password-1", 10) } });
  const { text } = syntheticMt5Export({ startDay: "2024-03-04", days: 60 });
  const ds = await importHistoricalDataset(user.id, { bytes: new TextEncoder().encode(text), fileName: "EURUSD_M1_202403040000_202405022359.csv" });
  const acct = await createLabAccount(user.id, { name: "Replay bench", datasets: [{ assetSymbol: "EURUSD", datasetId: ds.id }], periodStart: "2024-03-04", periodEnd: "2024-05-02", startingBalance: 10000, currency: "USD" });
  await startSimClock(user.id, acct.id);
  for (let i = 0; i < 30; i++) await advanceSimClock(user.id, acct.id, { kind: "NEXT_DAY" });
  console.log("ACCOUNT", acct.id);
  await prisma.$disconnect();
}
main();
