import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { lessonsTable } from "./courses";

export const courseProgressTable = pgTable(
  "course_progress",
  {
    userId: text("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    lessonId: text("lesson_id")
      .notNull()
      .references(() => lessonsTable.id, { onDelete: "cascade" }),
    completedAt: timestamp("completed_at").defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.lessonId] })],
);

export type CourseProgress = typeof courseProgressTable.$inferSelect;
