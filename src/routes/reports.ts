import { Router } from "express";
import { db } from "../db";
import { reportsTable, postsTable } from "../db";
import { eq, desc, and, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import crypto from "crypto";

const router = Router();

const AUTO_FLAG_THRESHOLD = 3;

router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { contentId, contentType, reason, details } = req.body;

  if (!contentId || !contentType || !reason) {
    res.status(400).json({ error: "contentId, contentType and reason are required" });
    return;
  }

  const duplicate = await db.query.reportsTable.findFirst({
    where: and(
      eq(reportsTable.userId, user.id),
      eq(reportsTable.contentId, contentId),
    ),
  });
  if (duplicate) {
    res.status(409).json({ error: "You have already reported this content." });
    return;
  }

  const id = crypto.randomUUID();
  const [report] = await db.insert(reportsTable).values({
    id, userId: user.id, contentId, contentType, reason, details: details ?? null, status: "pending",
  }).returning();

  if (contentType === "post") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(reportsTable)
      .where(eq(reportsTable.contentId, contentId));

    if (count >= AUTO_FLAG_THRESHOLD) {
      await db
        .update(postsTable)
        .set({ moderationStatus: "flagged" })
        .where(eq(postsTable.id, contentId));
      req.log.info({ contentId, count }, "Post auto-flagged after reaching report threshold");
    }
  }

  res.status(201).json({ ...report, autoFlagged: false });
});

router.get("/", requireAdmin, async (req, res) => {
  const { status } = req.query as { status?: string };
  const reports = await db.query.reportsTable.findMany({
    where: status ? eq(reportsTable.status, status) : undefined,
    orderBy: desc(reportsTable.createdAt),
    limit: 100,
    with: { reporter: true },
  });
  res.json(reports);
});

router.patch("/:id", requireAdmin, async (req, res) => {
  const { status } = req.body;
  await db.update(reportsTable).set({ status }).where(eq(reportsTable.id, req.params.id as string));
  res.json({ success: true });
});

export default router;
