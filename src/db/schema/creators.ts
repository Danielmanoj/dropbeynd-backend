import {
  pgTable,
  text,
  decimal,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const creatorsTable = pgTable("creators", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  bio: text("bio"),
  niche: text("niche"),
  avatarUrl: text("avatar_url"),
  coverUrl: text("cover_url"),
  monthlyPrice: decimal("monthly_price", { precision: 10, scale: 2 })
    .default("9.99")
    .notNull(),
  subscriberCount: integer("subscriber_count").default(0).notNull(),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCreatorSchema = createInsertSchema(creatorsTable).omit({
  createdAt: true,
  subscriberCount: true,
});
export const selectCreatorSchema = createSelectSchema(creatorsTable);

export type InsertCreator = z.infer<typeof insertCreatorSchema>;
export type Creator = typeof creatorsTable.$inferSelect;
