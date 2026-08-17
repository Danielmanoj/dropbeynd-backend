import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { creatorsTable } from "./creators";
import { usersTable } from "./users";

export const verificationStatusEnum = pgEnum("verification_status", [
  "pending", "approved", "rejected", "revoked",
]);

export const verificationsTable = pgTable("verification_requests", {
  id: text("id").primaryKey().notNull(),
  creatorId: text("creator_id").notNull().references(() => creatorsTable.id, { onDelete: "cascade" }),
  requestedById: text("requested_by_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  status: verificationStatusEnum("status").default("pending").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
  expiresAt: timestamp("expires_at"),
});

export type VerificationRequest = typeof verificationsTable.$inferSelect;
