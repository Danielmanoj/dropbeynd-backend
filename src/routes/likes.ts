import { Router } from "express";
import { db } from "../db";
import { likesTable, postsTable, creatorsTable, subscriptionsTable } from "../db";
import { eq, and, count } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../lib/auth";

const router = Router();

router.post("/:postId/like", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const postId = req.params.postId as string;

  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, postId),
    with: { creator: true },
  });
  if (!post) { res.status(404).json({ error: "Post not found" }); return; }

  // If post is locked, user must be the author or have an active subscription to view & like
  if (post.isLocked) {
    const isOwner = (post as any).creator?.userId === user.id;
    if (!isOwner) {
      const sub = await db.query.subscriptionsTable.findFirst({
        where: and(
          eq(subscriptionsTable.userId, user.id),
          eq(subscriptionsTable.creatorId, post.creatorId),
          eq(subscriptionsTable.status, "active"),
        ),
      });
      if (!sub) {
        res.status(403).json({ error: "Subscribe to unlock and like this post." });
        return;
      }
    }
  }

  await db.insert(likesTable).values({ userId: user.id, postId }).onConflictDoNothing();
  const [{ total }] = await db.select({ total: count() }).from(likesTable).where(eq(likesTable.postId, postId));
  res.json({ liked: true, likeCount: Number(total) });
});

router.delete("/:postId/like", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const postId = req.params.postId as string;

  await db.delete(likesTable).where(and(eq(likesTable.userId, user.id), eq(likesTable.postId, postId)));
  const [{ total }] = await db.select({ total: count() }).from(likesTable).where(eq(likesTable.postId, postId));
  res.json({ liked: false, likeCount: Number(total) });
});

router.get("/:postId/like-status", optionalAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const postId = req.params.postId as string;

  const [{ total }] = await db.select({ total: count() }).from(likesTable).where(eq(likesTable.postId, postId));
  if (!user) { res.json({ liked: false, likeCount: Number(total) }); return; }

  const existing = await db.query.likesTable.findFirst({
    where: and(eq(likesTable.userId, user.id), eq(likesTable.postId, postId)),
  });
  res.json({ liked: !!existing, likeCount: Number(total) });
});

export default router;
