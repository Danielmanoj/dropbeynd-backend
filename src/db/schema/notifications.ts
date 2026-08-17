import { pgTable, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { creatorsTable } from "./creators";

export const notificationTypeEnum = pgEnum("notification_type", [
  "new_post", "new_course", "followed_you", "verification_approved", "tip_received", "comment", "system",
]);

export const notificationsTable = pgTable("notifications", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").references(() => creatorsTable.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  link: text("link"),
  isRead: boolean("is_read").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Notification = typeof notificationsTable.$inferSelect;
