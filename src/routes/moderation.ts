/**
 * Moderation routes
 *
 * GET  /moderation/queue            — admin: list pending/review posts
 * POST /moderation/scan/:postId     — admin: manually trigger a re-scan
 * POST /moderation/webhook/:postId  — internal: called after upload to kick off async scan
 */

import { Router } from "express";
import { db } from "../db";
import { postsTable } from "../db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { scanMedia, verdictToStatus } from "../lib/moderation";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runScan(postId: string, log: any): Promise<void> {
  const post = await db.query.postsTable.findFirst({ where: eq(postsTable.id, postId) });
  if (!post) {
    log.warn({ postId }, "Moderation scan: post not found");
    return;
  }
  if (!post.mediaUrl || post.mediaType === "none" || post.mediaType === "pdf") {
    // Text-only or PDF post — approve immediately
    await db.update(postsTable)
      .set({ moderationStatus: "active", moderationProvider: "passthrough" })
      .where(eq(postsTable.id, postId));
    return;
  }

  const result = await scanMedia(post.mediaUrl, post.mediaType as "image" | "video" | "pdf" | "none");
  const newStatus = verdictToStatus(result.verdict);

  await db.update(postsTable).set({
    moderationStatus: newStatus,
    moderationScore: result.score.toFixed(4),
    moderationProvider: result.provider,
  }).where(eq(postsTable.id, postId));

  log.info({ postId, verdict: result.verdict, score: result.score, newStatus }, "Moderation scan applied");
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** GET /moderation/queue — admin view of items needing attention */
router.get("/moderation/queue", requireAuth, requireAdmin, async (req, res) => {
  const { status = "pending,review", limit = "100" } = req.query as Record<string, string>;
  const statuses = status.split(",").filter(Boolean) as Array<"pending" | "review" | "active" | "removed" | "flagged">;

  const posts = await db.query.postsTable.findMany({
    where: inArray(postsTable.moderationStatus, statuses),
    orderBy: (t, { asc }) => [asc(t.createdAt)],
    limit: Math.min(parseInt(limit) || 100, 500),
    with: { creator: true },
  });

  res.json(posts.map((p: any) => ({
    id: p.id,
    creatorId: p.creatorId,
    creatorName: p.creator?.name ?? "Unknown",
    creatorAvatarUrl: p.creator?.avatarUrl ?? null,
    title: p.title ?? null,
    body: p.body?.slice(0, 120) ?? null,
    mediaUrl: p.mediaUrl ?? null,
    mediaType: p.mediaType ?? "none",
    thumbnailUrl: p.thumbnailUrl ?? null,
    moderationStatus: p.moderationStatus,
    moderationScore: p.moderationScore ? parseFloat(p.moderationScore) : null,
    moderationProvider: p.moderationProvider ?? null,
    createdAt: p.createdAt,
  })));
});

/** POST /moderation/scan/:postId — admin: manually re-scan a specific post */
router.post("/moderation/scan/:postId", requireAuth, requireAdmin, async (req, res) => {
  const postId = req.params.postId as string;

  const post = await db.query.postsTable.findFirst({ where: eq(postsTable.id, postId) });
  if (!post) {
    res.status(404).json({ error: "Post not found" });
    return;
  }

  // Mark as pending while scanning
  await db.update(postsTable).set({ moderationStatus: "pending" }).where(eq(postsTable.id, postId));

  // Run synchronously so the admin gets the result immediately
  await runScan(postId, req.log);

  const updated = await db.query.postsTable.findFirst({ where: eq(postsTable.id, postId) });
  res.json({
    postId,
    moderationStatus: updated?.moderationStatus,
    moderationScore: updated?.moderationScore ? parseFloat(updated.moderationScore as unknown as string) : null,
    moderationProvider: updated?.moderationProvider,
  });
});

/** POST /moderation/webhook/:postId — called internally after a post is created to kick off scan */
router.post("/moderation/webhook/:postId", requireAuth, async (req, res) => {
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

  // Only the creator or an admin may trigger a scan
  if ((post as any).creator?.userId !== user.id && user.role !== "admin") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  // Respond immediately, run scan in background
  res.json({ queued: true, postId });

  runScan(postId, req.log).catch((err) => {
    req.log.error({ err, postId }, "Background moderation scan failed");
  });
});

export { runScan };
export default router;
