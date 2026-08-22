import { db } from "./db";
import { sql } from "drizzle-orm";

async function run() {
  console.log("Connecting to Postgres via db pool...");
  try {
    console.log("Applying schema updates...");
    await db.execute(sql`
      ALTER TABLE "posts" ADD COLUMN IF NOT EXISTS "views_count" integer DEFAULT 0 NOT NULL;
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role_selected" boolean DEFAULT false NOT NULL;
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "payment_methods" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "card_holder" text NOT NULL,
        "brand" varchar(30) DEFAULT 'visa' NOT NULL,
        "last4" varchar(4) NOT NULL,
        "exp_month" varchar(2) NOT NULL,
        "exp_year" varchar(4) NOT NULL,
        "is_default" boolean DEFAULT false NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "payout_accounts" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
        "creator_id" text REFERENCES "creators"("id") ON DELETE cascade,
        "bank_name" text NOT NULL,
        "account_holder_name" text NOT NULL,
        "account_number_last4" varchar(4) NOT NULL,
        "routing_number" varchar(30) NOT NULL,
        "account_type" varchar(20) DEFAULT 'checking' NOT NULL,
        "currency" varchar(3) DEFAULT 'usd' NOT NULL,
        "is_default" boolean DEFAULT true NOT NULL,
        "created_at" timestamp DEFAULT now() NOT NULL
      );
    `);

    console.log("Schema sync completed successfully!");
  } catch (err) {
    console.error("Error executing schema sync:", err);
  } finally {
    process.exit(0);
  }
}

run();
