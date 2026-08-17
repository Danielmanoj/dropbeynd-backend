import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { creatorsTable } from "./creators";
import { mediaTypeEnum } from "./posts";

export const storiesTable = pgTable("stories", {
  id: text("id").primaryKey().notNull(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => creatorsTable.id, { onDelete: "cascade" }),
  mediaUrl: text("media_url").notNull(),
  mediaType: mediaTypeEnum("media_type").default("image"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Story = typeof storiesTable.$inferSelect;
