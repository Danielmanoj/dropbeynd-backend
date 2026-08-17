import { Router } from "express";
import { db } from "../db";
import { notificationsTable } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { randomUUID } from "crypto";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = (req as any).dbUser?.id as string;
  const { limit = "20" } = req.query as Record<string, string>;
  const notifications = await db.query.notificationsTable.findMany({
    where: eq(notificationsTable.userId, userId),
    orderBy: desc(notificationsTable.createdAt),
    limit: Math.min(parseInt(limit) || 20, 100),
  });
  res.json(notifications);
});

router.get("/unread-count", requireAuth, async (req, res) => {
  const userId = (req as any).dbUser?.id as string;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.isRead, false)));
  res.json({ count: row?.count ?? 0 });
});

router.patch("/read-all", requireAuth, async (req, res) => {
  const userId = (req as any).dbUser?.id as string;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, userId));
  res.json({ success: true });
});

router.patch("/:notificationId/read", requireAuth, async (req, res) => {
  const notificationId = req.params.notificationId as string;
  const userId = (req as any).dbUser?.id as string;
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, notificationId), eq(notificationsTable.userId, userId)));
  res.json({ success: true });
});

export async function createNotification(params: {
  userId: string;
  creatorId?: string;
  type: "new_post" | "new_course" | "followed_you" | "verification_approved" | "tip_received" | "comment" | "system";
  title: string;
  body?: string;
  link?: string;
}) {
  await db.insert(notificationsTable).values({
    id: randomUUID(),
    userId: params.userId,
    creatorId: params.creatorId ?? null,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
    isRead: false,
  });
}

export default router;
