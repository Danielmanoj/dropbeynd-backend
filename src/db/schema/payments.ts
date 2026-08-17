import {
  pgTable,
  text,
  decimal,
  timestamp,
  pgEnum,
  varchar,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { creatorsTable } from "./creators";

export const paymentStatusEnum = pgEnum("payment_status", [
  "succeeded",
  "pending",
  "failed",
  "refunded",
]);

export const paymentsTable = pgTable("payments", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").references(() => creatorsTable.id, {
    onDelete: "set null",
  }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).default("usd").notNull(),
  status: paymentStatusEnum("status").default("pending").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({
  createdAt: true,
});
export const selectPaymentSchema = createSelectSchema(paymentsTable);

export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;

export const paymentMethodsTable = pgTable("payment_methods", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  cardHolder: text("card_holder").notNull(),
  brand: varchar("brand", { length: 30 }).default("visa").notNull(),
  last4: varchar("last4", { length: 4 }).notNull(),
  expMonth: varchar("exp_month", { length: 2 }).notNull(),
  expYear: varchar("exp_year", { length: 4 }).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPaymentMethodSchema = createInsertSchema(paymentMethodsTable).omit({
  createdAt: true,
});
export const selectPaymentMethodSchema = createSelectSchema(paymentMethodsTable);
export type InsertPaymentMethod = z.infer<typeof insertPaymentMethodSchema>;
export type PaymentMethod = typeof paymentMethodsTable.$inferSelect;

export const payoutAccountsTable = pgTable("payout_accounts", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").references(() => creatorsTable.id, {
    onDelete: "cascade",
  }),
  bankName: text("bank_name").notNull(),
  accountHolderName: text("account_holder_name").notNull(),
  accountNumberLast4: varchar("account_number_last4", { length: 4 }).notNull(),
  routingNumber: varchar("routing_number", { length: 30 }).notNull(),
  accountType: varchar("account_type", { length: 20 }).default("checking").notNull(),
  currency: varchar("currency", { length: 3 }).default("usd").notNull(),
  isDefault: boolean("is_default").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPayoutAccountSchema = createInsertSchema(payoutAccountsTable).omit({
  createdAt: true,
});
export const selectPayoutAccountSchema = createSelectSchema(payoutAccountsTable);
export type InsertPayoutAccount = z.infer<typeof insertPayoutAccountSchema>;
export type PayoutAccount = typeof payoutAccountsTable.$inferSelect;

