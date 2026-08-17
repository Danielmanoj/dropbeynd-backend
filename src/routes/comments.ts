import { Router } from "express";
import { db } from "../db";
import { commentsTable, postsTable, usersTable } from "../db";
import { eq, and, isNull, desc } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

router.get("/:postId/comments", optionalAuth, async (req, res) => {
  const postId = req.params.postId as string;

  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, postId),
  });
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const topLevel = await db.query.commentsTable.findMany({
    where: and(eq(commentsTable.postId, postId), isNull(commentsTable.parentId)),
    orderBy: desc(commentsTable.createdAt),
    limit: 50,
    with: { user: true },
  });

  const replies = await db.query.commentsTable.findMany({
    where: and(eq(commentsTable.postId, postId)),
    with: { user: true },
  });

  const replyMap: Record<string, any[]> = {};
  for (const r of replies) {
    if (r.parentId) {
      if (!replyMap[r.parentId]) replyMap[r.parentId] = [];
      replyMap[r.parentId].push({
        id: r.id,
        postId: r.postId,
        userId: r.userId,
        userName: (r as any).user?.name ?? "Anonymous",
        userAvatarUrl: (r as any).user?.avatarUrl ?? null,
        parentId: r.parentId,
        body: r.body,
        replies: [],
        createdAt: r.createdAt,
      });
    }
  }

  const result = topLevel.map((c: any) => ({
    id: c.id,
    postId: c.postId,
    userId: c.userId,
    userName: c.user?.name ?? "Anonymous",
    userAvatarUrl: c.user?.avatarUrl ?? null,
    parentId: c.parentId,
    body: c.body,
    replies: replyMap[c.id] ?? [],
    createdAt: c.createdAt,
  }));

  res.json(result);
});

router.post("/:postId/comments", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const postId = req.params.postId as string;
  const { body, parentId } = req.body;

  if (!body?.trim()) {
    res.status(400).json({ error: "Comment body is required" });
    return;
  }

  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, postId),
  });
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const id = crypto.randomUUID();
  const [comment] = await db.insert(commentsTable).values({
    id,
    postId,
    userId: user.id,
    body: body.trim(),
    parentId: parentId ?? null,
  }).returning();

  res.status(201).json({
    id: comment.id,
    postId: comment.postId,
    userId: comment.userId,
    userName: user.name ?? "Anonymous",
    userAvatarUrl: user.avatarUrl ?? null,
    parentId: comment.parentId,
    body: comment.body,
    replies: [],
    createdAt: comment.createdAt,
  });
});

export default router;
