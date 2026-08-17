import {
  pgTable,
  text,
  boolean,
  timestamp,
  pgEnum,
  numeric,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorsTable } from "./creators";

export const mediaTypeEnum = pgEnum("media_type", [
  "image",
  "video",
  "pdf",
  "none",
]);

export const moderationStatusEnum = pgEnum("moderation_status", [
  "active",
  "flagged",
  "removed",
  "pending",
  "review",
]);

export const postsTable = pgTable("posts", {
  id: text("id").primaryKey().notNull(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => creatorsTable.id, { onDelete: "cascade" }),
  title: text("title"),
  body: text("body"),
  mediaUrl: text("media_url"),
  thumbnailUrl: text("thumbnail_url"),
  mediaType: mediaTypeEnum("media_type").default("none"),
  isLocked: boolean("is_locked").default(false).notNull(),
  viewsCount: integer("views_count").default(0).notNull(),
  moderationStatus: moderationStatusEnum("moderation_status")
    .default("active")
    .notNull(),
  moderationScore: numeric("moderation_score", { precision: 5, scale: 4 }),
  moderationProvider: text("moderation_provider"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPostSchema = createInsertSchema(postsTable).omit({
  createdAt: true,
});
export const selectPostSchema = createSelectSchema(postsTable);

export type InsertPost = z.infer<typeof insertPostSchema>;
export type Post = typeof postsTable.$inferSelect;
