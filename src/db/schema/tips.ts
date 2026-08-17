import { pgTable, text, timestamp, numeric } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { creatorsTable } from "./creators";

export const tipsTable = pgTable("tips", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  creatorId: text("creator_id")
    .notNull()
    .references(() => creatorsTable.id, { onDelete: "cascade" }),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("usd").notNull(),
  message: text("message"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Tip = typeof tipsTable.$inferSelect;
