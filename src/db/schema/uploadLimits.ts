import {
  pgTable,
  text,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const userUploadLimitsTable = pgTable(
  "user_upload_limits",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    uploadCount: integer("upload_count").default(0).notNull(),
    date: text("date").notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [unique("user_upload_limits_user_date").on(t.userId, t.date)],
);

export type UserUploadLimit = typeof userUploadLimitsTable.$inferSelect;
