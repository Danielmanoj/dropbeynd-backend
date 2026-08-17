import { Router } from "express";
import { db } from "../db";
import { followsTable, creatorsTable } from "../db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../lib/auth";

const router = Router();

router.post("/:creatorId/follow", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const creatorId = req.params.creatorId as string;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.id, creatorId),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  await db.insert(followsTable).values({
    userId: user.id,
    creatorId,
  }).onConflictDoNothing();

  res.json({ following: true, creatorId });
});

router.delete("/:creatorId/follow", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const creatorId = req.params.creatorId as string;

  await db.delete(followsTable).where(
    and(eq(followsTable.userId, user.id), eq(followsTable.creatorId, creatorId))
  );

  res.json({ following: false, creatorId });
});

router.get("/:creatorId/follow-status", optionalAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const creatorId = req.params.creatorId as string;

  const [follow, followerCountRows] = await Promise.all([
    user
      ? db.query.followsTable.findFirst({
          where: and(eq(followsTable.userId, user.id), eq(followsTable.creatorId, creatorId)),
        })
      : Promise.resolve(null),
    db.select({ count: count() }).from(followsTable).where(eq(followsTable.creatorId, creatorId)),
  ]);

  res.json({ following: !!follow, followerCount: Number(followerCountRows[0]?.count ?? 0) });
});

export default router;
