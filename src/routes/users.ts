import { Router } from "express";
import { db } from "../db";
import {
  usersTable,
  creatorsTable,
  bookmarksTable,
  likesTable,
  postsTable,
  coursesTable,
  courseProgressTable,
  followsTable,
  subscriptionsTable,
  paymentMethodsTable,
  payoutAccountsTable,
  commentsTable,
  notificationsTable,
  verificationsTable,
} from "../db";
import { eq } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { clerkClient } from "@clerk/express";

const router = Router();

router.get("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  // Double check if a creator profile exists in creatorsTable
  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  const effectiveRole = user.role === "admin" ? "admin" : creator ? "creator" : user.role;

  res.json({
    id: user.id,
    clerkId: user.clerkId,
    email: user.email,
    name: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
    role: effectiveRole,
    roleSelected: user.roleSelected ?? (effectiveRole === "creator" || effectiveRole === "admin"),
    createdAt: user.createdAt,
  });
});

router.put("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { name, avatarUrl, roleSelected } = req.body;

  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;
  if (roleSelected !== undefined) updates.roleSelected = Boolean(roleSelected);

  if (Object.keys(updates).length === 0) {
    res.json({
      id: user.id,
      clerkId: user.clerkId,
      email: user.email,
      name: user.name ?? null,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role,
      roleSelected: user.roleSelected ?? (user.role === "creator" || user.role === "admin"),
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
    roleSelected: updated.roleSelected,
    createdAt: updated.createdAt,
  });
});

// ─── Delete Account with Confirmation ─────────────────────────────────────────
router.delete("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { confirmation } = req.body || {};

  if (!confirmation || confirmation.trim().toUpperCase() !== "DELETE MY ACCOUNT") {
    res.status(400).json({ error: "Please verify by entering 'DELETE MY ACCOUNT'." });
    return;
  }

  try {
    const creator = await db.query.creatorsTable.findFirst({
      where: eq(creatorsTable.userId, user.id),
    });

    if (creator) {
      await db.delete(postsTable).where(eq(postsTable.creatorId, creator.id));
      await db.delete(coursesTable).where(eq(coursesTable.creatorId, creator.id));
      await db.delete(verificationsTable).where(eq(verificationsTable.creatorId, creator.id));
      await db.delete(creatorsTable).where(eq(creatorsTable.id, creator.id));
    }

    await db.delete(bookmarksTable).where(eq(bookmarksTable.userId, user.id));
    await db.delete(likesTable).where(eq(likesTable.userId, user.id));
    await db.delete(courseProgressTable).where(eq(courseProgressTable.userId, user.id));
    await db.delete(followsTable).where(eq(followsTable.userId, user.id));
    await db.delete(subscriptionsTable).where(eq(subscriptionsTable.userId, user.id));
    await db.delete(paymentMethodsTable).where(eq(paymentMethodsTable.userId, user.id));
    await db.delete(payoutAccountsTable).where(eq(payoutAccountsTable.userId, user.id));
    await db.delete(commentsTable).where(eq(commentsTable.userId, user.id));
    await db.delete(notificationsTable).where(eq(notificationsTable.userId, user.id));

    await db.delete(usersTable).where(eq(usersTable.id, user.id));

    if (user.clerkId) {
      try {
        await clerkClient.users.deleteUser(user.clerkId);
      } catch (clerkErr) {
        req.log.warn({ clerkErr }, "Clerk user deletion skipped/failed");
      }
    }

    res.json({ success: true, message: "Account deleted permanently." });
  } catch (err: any) {
    req.log.error({ err }, "Account deletion error");
    res.status(500).json({ error: "Failed to delete account. Please try again." });
  }
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
