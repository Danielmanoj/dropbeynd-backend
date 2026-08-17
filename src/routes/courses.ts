import { Router } from "express";
import { db } from "../db";
import {
  coursesTable,
  lessonsTable,
  creatorsTable,
  courseProgressTable,
  subscriptionsTable,
} from "../db";
import { eq, and, asc, count } from "drizzle-orm";
import { requireAuth, requireCreator, optionalAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

router.post("/", requireAuth, requireCreator, async (req, res) => {
  const user = (req as any).dbUser;
  const { title, description, thumbnailUrl, isPublished } = req.body;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  if (!creator) {
    res.status(403).json({ error: "Creator profile required" });
    return;
  }

  const id = crypto.randomUUID();
  const [course] = await db.insert(coursesTable).values({
    id,
    creatorId: creator.id,
    title,
    description,
    thumbnailUrl,
    isPublished: isPublished ?? false,
  }).returning();

  const lessonCount = 0;
  res.status(201).json({
    id: course.id,
    creatorId: course.creatorId,
    title: course.title,
    description: course.description ?? null,
    thumbnailUrl: course.thumbnailUrl ?? null,
    isPublished: course.isPublished,
    lessonCount,
    createdAt: course.createdAt,
  });
});

router.get("/:courseId", optionalAuth, async (req, res) => {
  const courseId = req.params.courseId as string;
  const user = (req as any).dbUser;

  const course = await db.query.coursesTable.findFirst({
    where: eq(coursesTable.id, courseId),
    with: { creator: true },
  });

  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const lessons = await db.query.lessonsTable.findMany({
    where: eq(lessonsTable.courseId, courseId),
    orderBy: asc(lessonsTable.orderIndex),
  });

  let completedLessonIds = new Set<string>();
  if (user) {
    const progress = await db.query.courseProgressTable.findMany({
      where: eq(courseProgressTable.userId, user.id),
    });
    completedLessonIds = new Set(progress.map((p) => p.lessonId));
  }

  let isSubscribed = false;
  if (user && (course as any).creator) {
    const sub = await db.query.subscriptionsTable.findFirst({
      where: and(
        eq(subscriptionsTable.userId, user.id),
        eq(subscriptionsTable.creatorId, (course as any).creator.id),
        eq(subscriptionsTable.status, "active")
      ),
    });
    isSubscribed = !!sub;
  }

  const isOwner = user && (course as any).creator?.userId === user.id;

  res.json({
    id: course.id,
    creatorId: course.creatorId,
    creatorName: (course as any).creator?.name ?? "Unknown",
    title: course.title,
    description: course.description ?? null,
    thumbnailUrl: course.thumbnailUrl ?? null,
    isPublished: course.isPublished,
    lessons: lessons.map((l) => ({
      id: l.id,
      courseId: l.courseId,
      title: l.title,
      description: l.description ?? null,
      contentUrl: isSubscribed || isOwner ? l.contentUrl ?? null : null,
      contentType: l.contentType,
      orderIndex: l.orderIndex,
      isCompleted: completedLessonIds.has(l.id),
    })),
    createdAt: course.createdAt,
  });
});

router.put("/:courseId", requireAuth, requireCreator, async (req, res) => {
  const courseId = req.params.courseId as string;
  const user = (req as any).dbUser;
  const { title, description, thumbnailUrl, isPublished } = req.body;

  const course = await db.query.coursesTable.findFirst({
    where: eq(coursesTable.id, courseId),
    with: { creator: true },
  });

  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  if ((course as any).creator?.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (thumbnailUrl !== undefined) updates.thumbnailUrl = thumbnailUrl;
  if (isPublished !== undefined) updates.isPublished = isPublished;

  const [updated] = await db
    .update(coursesTable)
    .set(updates)
    .where(eq(coursesTable.id, courseId))
    .returning();

  const lessonCount = await db.select({ count: count() }).from(lessonsTable).where(eq(lessonsTable.courseId, courseId));

  res.json({
    id: updated.id,
    creatorId: updated.creatorId,
    title: updated.title,
    description: updated.description ?? null,
    thumbnailUrl: updated.thumbnailUrl ?? null,
    isPublished: updated.isPublished,
    lessonCount: lessonCount[0]?.count ?? 0,
    createdAt: updated.createdAt,
  });
});

router.post("/:courseId/lessons", requireAuth, requireCreator, async (req, res) => {
  const courseId = req.params.courseId as string;
  const user = (req as any).dbUser;
  const { title, description, contentUrl, contentType, orderIndex } = req.body;

  const course = await db.query.coursesTable.findFirst({
    where: eq(coursesTable.id, courseId),
    with: { creator: true },
  });

  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  if ((course as any).creator?.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const id = crypto.randomUUID();
  const [lesson] = await db.insert(lessonsTable).values({
    id,
    courseId,
    title,
    description,
    contentUrl,
    contentType: contentType ?? "text",
    orderIndex: orderIndex ?? 0,
  }).returning();

  res.status(201).json({
    id: lesson.id,
    courseId: lesson.courseId,
    title: lesson.title,
    description: lesson.description ?? null,
    contentUrl: lesson.contentUrl ?? null,
    contentType: lesson.contentType,
    orderIndex: lesson.orderIndex,
    isCompleted: false,
  });
});

router.get("/:courseId/progress", requireAuth, async (req, res) => {
  const courseId = req.params.courseId as string;
  const user = (req as any).dbUser;

  const lessons = await db.query.lessonsTable.findMany({
    where: eq(lessonsTable.courseId, courseId),
  });

  const progress = await db.query.courseProgressTable.findMany({
    where: eq(courseProgressTable.userId, user.id),
  });

  const completedSet = new Set(progress.map((p) => p.lessonId));
  const completedLessons = lessons.filter((l) => completedSet.has(l.id)).map((l) => l.id);
  const totalLessons = lessons.length;
  const percentComplete = totalLessons > 0 ? (completedLessons.length / totalLessons) * 100 : 0;

  res.json({
    courseId,
    completedLessons,
    totalLessons,
    percentComplete,
  });
});

router.put("/:courseId/progress", requireAuth, async (req, res) => {
  const courseId = req.params.courseId as string;
  const user = (req as any).dbUser;
  const { lessonId, completed } = req.body;

  if (!lessonId || typeof lessonId !== "string") {
    res.status(400).json({ error: "lessonId is required" });
    return;
  }

  // Prevent IDOR: the lesson must actually belong to this course, and the
  // requesting user must have access to the course (subscribed to the
  // creator, or be the creator themselves) before their progress can move.
  const lesson = await db.query.lessonsTable.findFirst({
    where: and(eq(lessonsTable.id, lessonId), eq(lessonsTable.courseId, courseId)),
  });
  if (!lesson) {
    res.status(404).json({ error: "Lesson not found in this course" });
    return;
  }

  const course = await db.query.coursesTable.findFirst({
    where: eq(coursesTable.id, courseId),
    with: { creator: true },
  });
  if (!course) {
    res.status(404).json({ error: "Course not found" });
    return;
  }

  const isOwner = (course as any).creator?.userId === user.id;
  if (!isOwner) {
    const sub = await db.query.subscriptionsTable.findFirst({
      where: and(
        eq(subscriptionsTable.userId, user.id),
        eq(subscriptionsTable.creatorId, (course as any).creator.id),
        eq(subscriptionsTable.status, "active"),
      ),
    });
    if (!sub) {
      res.status(403).json({ error: "Subscribe to track progress on this course" });
      return;
    }
  }

  if (completed) {
    await db.insert(courseProgressTable).values({
      userId: user.id,
      lessonId,
    }).onConflictDoNothing();
  } else {
    await db.delete(courseProgressTable).where(
      and(eq(courseProgressTable.userId, user.id), eq(courseProgressTable.lessonId, lessonId))
    );
  }

  const lessons = await db.query.lessonsTable.findMany({
    where: eq(lessonsTable.courseId, courseId),
  });
  const progress = await db.query.courseProgressTable.findMany({
    where: eq(courseProgressTable.userId, user.id),
  });
  const completedSet = new Set(progress.map((p) => p.lessonId));
  const completedLessons = lessons.filter((l) => completedSet.has(l.id)).map((l) => l.id);
  const totalLessons = lessons.length;
  const percentComplete = totalLessons > 0 ? (completedLessons.length / totalLessons) * 100 : 0;

  res.json({
    courseId,
    completedLessons,
    totalLessons,
    percentComplete,
  });
});

export default router;
