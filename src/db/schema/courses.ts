import {
  pgTable,
  text,
  boolean,
  timestamp,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorsTable } from "./creators";

export const lessonContentTypeEnum = pgEnum("lesson_content_type", [
  "video",
  "pdf",
  "text",
]);

export const coursesTable = pgTable("courses", {
  id: text("id").primaryKey().notNull(),
  creatorId: text("creator_id")
    .notNull()
    .references(() => creatorsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  thumbnailUrl: text("thumbnail_url"),
  isPublished: boolean("is_published").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const lessonsTable = pgTable("lessons", {
  id: text("id").primaryKey().notNull(),
  courseId: text("course_id")
    .notNull()
    .references(() => coursesTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  contentUrl: text("content_url"),
  contentType: lessonContentTypeEnum("content_type").default("text").notNull(),
  orderIndex: integer("order_index").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCourseSchema = createInsertSchema(coursesTable).omit({
  createdAt: true,
});
export const insertLessonSchema = createInsertSchema(lessonsTable).omit({
  createdAt: true,
});
export const selectCourseSchema = createSelectSchema(coursesTable);
export const selectLessonSchema = createSelectSchema(lessonsTable);

export type InsertCourse = z.infer<typeof insertCourseSchema>;
export type InsertLesson = z.infer<typeof insertLessonSchema>;
export type Course = typeof coursesTable.$inferSelect;
export type Lesson = typeof lessonsTable.$inferSelect;
