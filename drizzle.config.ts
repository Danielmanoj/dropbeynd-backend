import { defineConfig } from "drizzle-kit";
import path from "path";
import fs from "fs";

if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(process.cwd(), "../../.env");
  const localEnvPath = path.resolve(process.cwd(), ".env");
  const target = fs.existsSync(envPath) ? envPath : fs.existsSync(localEnvPath) ? localEnvPath : null;
  if (target && typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile(target);
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
