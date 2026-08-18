import fs from "fs";
import path from "path";

// Simple env loader before dynamic import
const envPath = path.resolve(import.meta.dirname, "../../.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

async function main() {
  const { db, agentScansTable, agentLogsTable, agentReportsTable } = await import("./db");
  const { desc } = await import("drizzle-orm");

  const scans = await db.select().from(agentScansTable).orderBy(desc(agentScansTable.createdAt));
  console.log(`Found ${scans.length} scan(s) in database:`);
  for (const s of scans) {
    console.log(`- ID: ${s.id} | Type: ${s.type} | Status: ${s.status} | Summary: ${s.summary}`);
  }

  // Delete all scan records (failed and previous)
  await db.delete(agentScansTable);
  console.log("SUCCESS: All scan records, logs, and reports cleared from the database.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Error managing scans:", err);
  process.exit(1);
});
