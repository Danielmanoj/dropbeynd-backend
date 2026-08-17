import { Router } from "express";
import { db } from "../db";
import {
  usersTable,
  creatorsTable,
  bookmarksTable,
  likesTable,
} from "../db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  res.json({
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    name: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    createdAt: user.createdAt,
  });
});

router.put("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { name, avatarUrl } = req.body;

  const updates: Record<string, string> = {};
  if (name !== undefined) updates.name = name;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

  if (Object.keys(updates).length === 0) {
    res.json({
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      name: user.name ?? null,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      createdAt: user.createdAt,
    });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, user.id))
    .returning();

  if (avatarUrl !== undefined || name !== undefined) {
    const creatorUpdates: Record<string, any> = {};
    if (avatarUrl !== undefined) creatorUpdates.avatarUrl = avatarUrl;
    if (name !== undefined) creatorUpdates.name = name;
    await db.update(creatorsTable).set(creatorUpdates).where(eq(creatorsTable.userId, user.id));
  }

  res.json({
    id: updated.id,
    clerkId: updated.clerkId,
    email: updated.email,
    name: updated.name ?? null,
    avatarUrl: updated.avatarUrl ?? null,
    role: updated.role,
    createdAt: updated.createdAt,
  });
});

router.get("/bookmarks", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  const bookmarks = await db.query.bookmarksTable.findMany({
    where: eq(bookmarksTable.userId, user.id),
    with: { post: { with: { creator: true } } },
  });

  const posts = bookmarks.map((b: any) => {
    const p = b.post;
    const c = p?.creator;
    return {
      id: p.id,
      creatorId: p.creatorId,
      creatorName: c?.name ?? "Unknown",
      creatorAvatarUrl: c?.avatarUrl ?? null,
      title: p.title ?? null,
      body: p.body ?? null,
      mediaUrl: p.mediaUrl ?? null,
      thumbnailUrl: p.thumbnailUrl ?? null,
      mediaType: p.mediaType ?? null,
      isLocked: p.isLocked,
      isBookmarked: true,
      moderationStatus: p.moderationStatus,
      createdAt: p.createdAt,
    };
  });

  res.json(posts);
});

router.get("/liked-posts", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  const likes = await db.query.likesTable.findMany({
    where: eq(likesTable.userId, user.id),
    with: { post: { with: { creator: true } } },
  });

  const posts = likes
    .filter((l: any) => l.post)
    .map((l: any) => {
      const p = l.post;
      const c = p?.creator;
      return {
        id: p.id,
        creatorId: p.creatorId,
        creatorName: c?.name ?? "Unknown",
        creatorAvatarUrl: c?.avatarUrl ?? null,
        title: p.title ?? null,
        body: p.body ?? null,
        mediaUrl: p.mediaUrl ?? null,
        thumbnailUrl: p.thumbnailUrl ?? null,
        mediaType: p.mediaType ?? null,
        isLocked: p.isLocked,
        isBookmarked: false,
        moderationStatus: p.moderationStatus,
        createdAt: p.createdAt,
      };
    });

  res.json(posts);
});

export default router;
