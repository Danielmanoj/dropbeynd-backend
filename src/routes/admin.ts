import { Router } from "express";
import { db } from "../db";
import {
  usersTable,
  creatorsTable,
  postsTable,
  subscriptionsTable,
  paymentsTable,
  verificationsTable,
} from "../db";
import { eq, count, desc, and, gte, sql, ne, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const PLATFORM_COMMISSION_RATE = 0.2;
const router = Router();

router.get("/stats", requireAuth, requireAdmin, async (req, res) => {
  const now = new Date();
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    totalUsersRows, totalCreatorsRows, totalSubsRows, activeSubsRows,
    totalRevenueRows, recentSignupsRows, suspendedRows, flaggedRows,
  ] = await Promise.all([
    db.select({ count: count() }).from(usersTable).where(ne(usersTable.role, "admin")),
    db.select({ count: count() }).from(creatorsTable),
    db.select({ count: count() }).from(subscriptionsTable),
    db.select({ count: count() }).from(subscriptionsTable).where(eq(subscriptionsTable.status, "active")),
    db.select({ total: sql<string>`COALESCE(SUM(${paymentsTable.amount}), 0)` }).from(paymentsTable).where(eq(paymentsTable.status, "succeeded")),
    db.select({ count: count() }).from(usersTable).where(gte(usersTable.createdAt, last30Days)),
    db.select({ count: count() }).from(usersTable).where(eq(usersTable.isSuspended, true)),
    db.select({ count: count() }).from(postsTable).where(eq(postsTable.moderationStatus, "flagged")),
  ]);

  const totalRevenue = parseFloat(totalRevenueRows[0]?.total ?? "0");

  res.json({
    totalUsers: totalUsersRows[0]?.count ?? 0,
    totalCreators: totalCreatorsRows[0]?.count ?? 0,
    totalSubscriptions: totalSubsRows[0]?.count ?? 0,
    totalRevenue,
    platformCommission: totalRevenue * PLATFORM_COMMISSION_RATE,
    activeSubscriptions: activeSubsRows[0]?.count ?? 0,
    recentSignups: recentSignupsRows[0]?.count ?? 0,
    suspendedUsers: suspendedRows[0]?.count ?? 0,
    flaggedPosts: flaggedRows[0]?.count ?? 0,
  });
});

router.get("/users", requireAuth, requireAdmin, async (req, res) => {
  const { limit = "200", offset = "0", role } = req.query as Record<string, string>;

  const conditions: any[] = [ne(usersTable.role, "admin")];
  if (role && role !== "all") {
    conditions.push(eq(usersTable.role, role as "user" | "creator"));
  }

  const users = await db.query.usersTable.findMany({
    where: and(...conditions),
    orderBy: desc(usersTable.createdAt),
    limit: Math.min(parseInt(limit) || 200, 500),
    offset: parseInt(offset) || 0,
  });

  res.json(users.map((u) => ({
    id: u.id,
    clerkId: u.clerkId,
    email: u.email,
    name: u.name ?? null,
    avatarUrl: u.avatarUrl ?? null,
    role: u.role,
    isSuspended: u.isSuspended,
    createdAt: u.createdAt,
  })));
});

router.get("/creators", requireAuth, requireAdmin, async (req, res) => {
  const creators = await db.query.creatorsTable.findMany({
    orderBy: desc(creatorsTable.subscriberCount),
  });

  if (creators.length === 0) {
    res.json([]);
    return;
  }

  const creatorIds = creators.map(c => c.id);
  const [postCountRows, verifiedRows] = await Promise.all([
    db.select({ creatorId: postsTable.creatorId, cnt: count() })
      .from(postsTable)
      .where(inArray(postsTable.creatorId, creatorIds))
      .groupBy(postsTable.creatorId),
    db.selectDistinct({ creatorId: verificationsTable.creatorId })
      .from(verificationsTable)
      .where(and(inArray(verificationsTable.creatorId, creatorIds), eq(verificationsTable.status, "approved"))),
  ]);

  const postCountMap = new Map(postCountRows.map(r => [r.creatorId, Number(r.cnt)]));
  const verifiedSet = new Set(verifiedRows.map(r => r.creatorId));

  res.json(creators.map(c => ({
    id: c.id,
    userId: c.userId,
    name: c.name,
    bio: c.bio ?? null,
    niche: c.niche ?? null,
    avatarUrl: c.avatarUrl ?? null,
    monthlyPrice: parseFloat(c.monthlyPrice as unknown as string),
    subscriberCount: c.subscriberCount,
    postCount: postCountMap.get(c.id) ?? 0,
    isVerified: verifiedSet.has(c.id),
    createdAt: c.createdAt,
  })));
});

router.get("/content", requireAuth, requireAdmin, async (req, res) => {
  const { status, limit = "200" } = req.query as Record<string, string>;

  const conditions: any[] = [];
  if (status && status !== "all") {
    conditions.push(eq(postsTable.moderationStatus, status as "active" | "flagged" | "removed" | "pending" | "review"));
  }

  const posts = await db.query.postsTable.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    orderBy: desc(postsTable.createdAt),
    limit: Math.min(parseInt(limit) || 200, 500),
    with: { creator: true },
  });

  res.json(posts.map((p: any) => ({
    id: p.id,
    creatorId: p.creatorId,
    creatorName: p.creator?.name ?? "Unknown",
    creatorAvatarUrl: p.creator?.avatarUrl ?? null,
    title: p.title ?? null,
    body: p.body ?? null,
    mediaUrl: p.mediaUrl ?? null,
    thumbnailUrl: p.thumbnailUrl ?? null,
    mediaType: p.mediaType ?? "none",
    isLocked: p.isLocked,
    moderationStatus: p.moderationStatus,
    moderationScore: p.moderationScore ? parseFloat(p.moderationScore) : null,
    createdAt: p.createdAt,
  })));
});

router.post("/content/:postId/moderate", requireAuth, requireAdmin, async (req, res) => {
  const postId = req.params.postId as string;
  const { action } = req.body;
  const statusMap: Record<string, string> = {
    approve: "active", flag: "flagged", remove: "removed", review: "review",
  };
  const newStatus = statusMap[action];
  if (!newStatus) { res.status(400).json({ error: "Invalid action" }); return; }
  const [updated] = await db.update(postsTable).set({ moderationStatus: newStatus as any }).where(eq(postsTable.id, postId)).returning();
  if (!updated) { res.status(404).json({ error: "Post not found" }); return; }
  res.json({ id: updated.id, moderationStatus: updated.moderationStatus });
});

router.patch("/users/:userId/suspend", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.userId as string;
  const { suspended } = req.body as { suspended: boolean };
  const [updated] = await db.update(usersTable).set({ isSuspended: !!suspended }).where(eq(usersTable.id, userId)).returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ id: updated.id, email: updated.email, isSuspended: updated.isSuspended });
});

router.delete("/users/:userId", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.userId as string;
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  res.json({ success: true });
});

router.delete("/content/:postId", requireAuth, requireAdmin, async (req, res) => {
  const postId = req.params.postId as string;
  await db.delete(postsTable).where(eq(postsTable.id, postId));
  res.json({ success: true });
});

// ─── PATCH /admin/users/:userId/promote ──────────────────────────────────────
// Promote a user to admin role.

router.patch("/users/:userId/promote", requireAuth, requireAdmin, async (req, res) => {
  const userId = req.params.userId as string;
  const [updated] = await db
    .update(usersTable)
    .set({ role: "admin" })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!updated) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ id: updated.id, email: updated.email, role: updated.role });
});

// ─── POST /admin/add-admin-by-email ──────────────────────────────────────────
// Assign admin role to any email (creates placeholder if user doesn't exist yet).

router.post("/add-admin-by-email", requireAuth, requireAdmin, async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email?.includes("@")) { res.status(400).json({ error: "Valid email required" }); return; }

  const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
  if (existing) {
    const [updated] = await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.email, email)).returning();
    res.json({ id: updated.id, email: updated.email, role: updated.role, created: false });
    return;
  }

  // User hasn't signed up yet — store the email so auth.ts promotes on first login.
  // We can't create a full user without a clerkId; return a note instead.
  res.json({
    email,
    note: "Email not yet registered. They will be auto-promoted to admin on first sign-in if you set ADMIN_EMAIL, or promote manually after they sign up.",
    created: false,
    exists: false,
  });
});

export default router;
