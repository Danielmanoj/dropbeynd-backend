import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const reportReasonEnum = pgEnum("report_reason", [
  "spam",
  "abuse",
  "misinformation",
  "nudity",
  "copyright",
  "other",
]);

export const reportContentTypeEnum = pgEnum("report_content_type", [
  "post",
  "course",
  "comment",
  "creator",
]);

export const reportsTable = pgTable("reports", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  contentId: text("content_id").notNull(),
  contentType: reportContentTypeEnum("content_type").notNull(),
  reason: reportReasonEnum("reason").notNull(),
  details: text("details"),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Report = typeof reportsTable.$inferSelect;
