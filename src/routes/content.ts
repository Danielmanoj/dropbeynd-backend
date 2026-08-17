import { Router } from "express";
import { db } from "../db";
import {
  postsTable,
  creatorsTable,
  bookmarksTable,
  subscriptionsTable,
} from "../db";
import { eq, desc, and, inArray, sql, ne } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatPost(p: any, extra: { isBookmarked?: boolean; canAccess?: boolean } = {}) {
  const canAccess = extra.canAccess ?? !p.isLocked;
  return {
    id: p.id,
    creatorId: p.creatorId,
    creatorName: p.creator?.name ?? "Unknown",
    creatorAvatarUrl: p.creator?.avatarUrl ?? null,
    creatorMonthlyPrice: p.creator?.monthlyPrice ? parseFloat(p.creator.monthlyPrice as unknown as string) : null,
    creatorNiche: p.creator?.niche ?? null,
    title: p.title ?? null,
    body: canAccess ? p.body ?? null : null,
    mediaUrl: canAccess ? p.mediaUrl ?? null : null,
    thumbnailUrl: p.thumbnailUrl ?? null,
    mediaType: p.mediaType ?? "none",
    isLocked: p.isLocked,
    viewsCount: p.viewsCount ?? 0,
    isBookmarked: extra.isBookmarked ?? false,
    moderationStatus: p.moderationStatus,
    createdAt: p.createdAt,
  };
}

// ─── GET /feed ────────────────────────────────────────────────────────────────

router.get("/feed", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { limit = "20", offset = "0" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 20, 100);
  const off = parseInt(offset) || 0;

  const [activeSubs, userCreator] = await Promise.all([
    db.query.subscriptionsTable.findMany({
      where: and(eq(subscriptionsTable.userId, user.id), eq(subscriptionsTable.status, "active")),
    }),
    db.query.creatorsTable.findFirst({
      where: eq(creatorsTable.userId, user.id),
    }),
  ]);
  const creatorIds = activeSubs.map((s) => s.creatorId);
  const myCreatorId = userCreator?.id;

  // Always pull recent active posts from every creator — free/unlocked content
  // should be visible in the feed regardless of subscription status. Locked
  // posts from non-subscribed creators are masked below via `canAccess`.
  const [posts, bookmarks] = await Promise.all([
    db.query.postsTable.findMany({
      where: ne(postsTable.moderationStatus, "removed"),
      orderBy: desc(postsTable.createdAt),
      limit: lim,
      offset: off,
      with: { creator: true },
    }),
    db.query.bookmarksTable.findMany({ where: eq(bookmarksTable.userId, user.id) }),
  ]);

  const bookmarkedIds = new Set(bookmarks.map((b) => b.postId));
  const subscribedCreatorIds = new Set(creatorIds);

  res.json(posts.map((p: any) => formatPost(p, {
    isBookmarked: bookmarkedIds.has(p.id),
    canAccess: !p.isLocked || (myCreatorId && p.creatorId === myCreatorId) || subscribedCreatorIds.has(p.creatorId),
  })));
});

// ─── POST /posts/:postId/view ─────────────────────────────────────────────────

router.post("/posts/:postId/view", optionalAuth, async (req, res) => {
  const postId = req.params.postId as string;
  try {
    const [post] = await db
      .update(postsTable)
      .set({ viewsCount: sql`${postsTable.viewsCount} + 1` })
      .where(eq(postsTable.id, postId))
      .returning();

    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    res.json({ success: true, viewsCount: post.viewsCount });
  } catch (err) {
    res.status(500).json({ error: "Could not record view" });
  }
});

// ─── POST /posts ──────────────────────────────────────────────────────────────

router.post("/posts", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { title, body, mediaUrl, thumbnailUrl, mediaType, isLocked } = req.body;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  if (!creator) {
    res.status(403).json({ error: "You must be a creator to post" });
    return;
  }

  const id = crypto.randomUUID();
  const hasMedia = !!(mediaUrl && mediaType && mediaType !== "none" && mediaType !== "pdf");

  const [post] = await db.insert(postsTable).values({
    id,
    creatorId: creator.id,
    title,
    body,
    mediaUrl,
    thumbnailUrl: thumbnailUrl ?? null,
    mediaType,
    isLocked: isLocked ?? false,
    moderationStatus: "active",
  }).returning();

  res.status(201).json({
    ...formatPost({ ...post, creator }, { isBookmarked: false, canAccess: true }),
    _moderationPending: hasMedia,
  });

  // Kick off background moderation scan after responding to the client
  if (hasMedia) {
    import("./moderation").then(({ runScan }) => {
      runScan(id, req.log).catch((err: any) => {
        req.log.error({ err, postId: id }, "Post-creation moderation scan failed");
      });
    });
  }
});

// ─── GET /posts/:postId ───────────────────────────────────────────────────────

router.get("/posts/:postId", optionalAuth, async (req, res) => {
  const postId = req.params.postId as string;
  const user = (req as any).dbUser;

  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, postId),
    with: { creator: true },
  });

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  const isOwner = user && (post as any).creator?.userId === user.id;
  const isAdmin = user && user.role === "admin";

  // Posts that are not yet approved (pending scan, under review, or rejected
  // for nudity/policy violations) must never be visible to anyone except the
  // post's own creator or an admin — even via direct-ID lookup.
  if (post.moderationStatus !== "active" && !isOwner && !isAdmin) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  let isBookmarked = false;
  let isSubscribed = false;

  if (user) {
    const [bookmark, sub] = await Promise.all([
      db.query.bookmarksTable.findFirst({
        where: and(eq(bookmarksTable.userId, user.id), eq(bookmarksTable.postId, postId)),
      }),
      db.query.subscriptionsTable.findFirst({
        where: and(
          eq(subscriptionsTable.userId, user.id),
          eq(subscriptionsTable.creatorId, (post as any).creatorId),
          eq(subscriptionsTable.status, "active")
        ),
      }),
    ]);
    isBookmarked = !!bookmark;
    isSubscribed = !!sub;
  }

  const canAccess = !post.isLocked || isSubscribed || !!isOwner;

  res.json(formatPost(post, { isBookmarked, canAccess }));
});

// ─── PUT /posts/:postId ───────────────────────────────────────────────────────

router.put("/posts/:postId", requireAuth, async (req, res) => {
  const postId = req.params.postId as string;
  const user = (req as any).dbUser;
  const { title, body, isLocked } = req.body;

  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, postId),
    with: { creator: true },
  });

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  if ((post as any).creator?.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  if (typeof title === "string" && title.length > 200) {
    res.status(400).json({ error: "title must be 200 characters or fewer" });
    return;
  }
  if (typeof body === "string" && body.length > 10000) {
    res.status(400).json({ error: "body must be 10000 characters or fewer" });
    return;
  }

  const updates: Record<string, any> = {};
  if (title !== undefined) updates.title = title;
  if (body !== undefined) updates.body = body;
  if (isLocked !== undefined) updates.isLocked = isLocked;

  const [updated] = await db
    .update(postsTable)
    .set(updates)
    .where(eq(postsTable.id, postId))
    .returning();

  res.json(formatPost({ ...updated, creator: (post as any).creator }, { isBookmarked: false, canAccess: true }));
});

// ─── DELETE /posts/:postId ────────────────────────────────────────────────────

router.delete("/posts/:postId", requireAuth, async (req, res) => {
  const postId = req.params.postId as string;
  const user = (req as any).dbUser;

  const post = await db.query.postsTable.findFirst({
    where: eq(postsTable.id, postId),
    with: { creator: true },
  });

  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  if ((post as any).creator?.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.delete(postsTable).where(eq(postsTable.id, postId));
  res.status(204).send();
});

// ─── POST /posts/:postId/bookmark ─────────────────────────────────────────────

router.post("/posts/:postId/bookmark", requireAuth, async (req, res) => {
  const postId = req.params.postId as string;
  const user = (req as any).dbUser;
  const { bookmarked } = req.body;

  if (bookmarked) {
    await db.insert(bookmarksTable).values({ userId: user.id, postId }).onConflictDoNothing();
  } else {
    await db.delete(bookmarksTable).where(
      and(eq(bookmarksTable.userId, user.id), eq(bookmarksTable.postId, postId))
    );
  }

  res.json({ bookmarked });
});

export default router;
