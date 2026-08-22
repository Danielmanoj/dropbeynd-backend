import { Router } from "express";
import { db } from "../db";
import {
  creatorsTable,
  usersTable,
  postsTable,
  coursesTable,
  subscriptionsTable,
  paymentsTable,
  lessonsTable,
  verificationsTable,
} from "../db";
import {
  eq,
  ilike,
  and,
  desc,
  count,
  gte,
  gt,
  or,
  isNull,
  sql,
  inArray,
  ne,
} from "drizzle-orm";
import { requireAuth, requireCreator, optionalAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

router.get("/", async (req, res) => {
  const { niche, search, limit = "20", offset = "0" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 20, 100);
  const off = parseInt(offset) || 0;

  const conditions = [];
  if (niche) conditions.push(ilike(creatorsTable.niche, niche));
  if (search) conditions.push(ilike(creatorsTable.name, `%${search}%`));

  const [creatorsRows, totalRows] = await Promise.all([
    db.query.creatorsTable.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      limit: lim,
      offset: off,
      orderBy: desc(creatorsTable.subscriberCount),
    }),
    db.select({ count: count() }).from(creatorsTable).where(
      conditions.length > 0 ? and(...conditions) : undefined
    ),
  ]);

  if (creatorsRows.length === 0) {
    res.json({ creators: [], total: totalRows[0]?.count ?? 0 });
    return;
  }

  const creatorIds = creatorsRows.map(c => c.id);

  const [postCountRows, courseCountRows, verifiedRows] = await Promise.all([
    db.select({ creatorId: postsTable.creatorId, cnt: count() })
      .from(postsTable)
      .where(inArray(postsTable.creatorId, creatorIds))
      .groupBy(postsTable.creatorId),
    db.select({ creatorId: coursesTable.creatorId, cnt: count() })
      .from(coursesTable)
      .where(inArray(coursesTable.creatorId, creatorIds))
      .groupBy(coursesTable.creatorId),
    db.selectDistinct({ creatorId: verificationsTable.creatorId })
      .from(verificationsTable)
      .where(and(
        inArray(verificationsTable.creatorId, creatorIds),
        eq(verificationsTable.status, "approved"),
        or(isNull(verificationsTable.expiresAt), gt(verificationsTable.expiresAt, sql`now()`)),
      )),
  ]);

  const postCountMap = new Map(postCountRows.map(r => [r.creatorId, Number(r.cnt)]));
  const courseCountMap = new Map(courseCountRows.map(r => [r.creatorId, Number(r.cnt)]));
  const verifiedSet = new Set(verifiedRows.map(r => r.creatorId));

  const enriched = creatorsRows.map(c => ({
    id: c.id,
    userId: c.userId,
    name: c.name,
    bio: c.bio ?? null,
    niche: c.niche ?? null,
    avatarUrl: c.avatarUrl ?? null,
    coverUrl: c.coverUrl ?? null,
    monthlyPrice: parseFloat(c.monthlyPrice as unknown as string),
    subscriberCount: c.subscriberCount,
    postCount: postCountMap.get(c.id) ?? 0,
    courseCount: courseCountMap.get(c.id) ?? 0,
    isVerified: verifiedSet.has(c.id),
    stripeProductId: c.stripeProductId ?? null,
    stripePriceId: c.stripePriceId ?? null,
    createdAt: c.createdAt,
  }));

  res.json({ creators: enriched, total: totalRows[0]?.count ?? 0 });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  let creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });

  if (!creator && user.name) {
    const creatorByName = await db.query.creatorsTable.findFirst({
      where: eq(creatorsTable.name, user.name),
    });
    if (creatorByName) {
      await db.update(creatorsTable).set({ userId: user.id }).where(eq(creatorsTable.id, creatorByName.id));
      await db.update(usersTable).set({ role: "creator", roleSelected: true }).where(eq(usersTable.id, user.id));
      creator = creatorByName;
    }
  }

  if (!creator) {
    res.status(404).json({ error: "Creator profile not found" });
    return;
  }

  const [postCount, courseCount] = await Promise.all([
    db.select({ count: count() }).from(postsTable).where(eq(postsTable.creatorId, creator.id)),
    db.select({ count: count() }).from(coursesTable).where(eq(coursesTable.creatorId, creator.id)),
  ]);

  res.json({
    id: creator.id,
    userId: creator.userId,
    name: creator.name,
    bio: creator.bio ?? null,
    niche: creator.niche ?? null,
    avatarUrl: creator.avatarUrl ?? null,
    coverUrl: creator.coverUrl ?? null,
    monthlyPrice: parseFloat(creator.monthlyPrice as unknown as string),
    subscriberCount: creator.subscriberCount,
    postCount: postCount[0]?.count ?? 0,
    courseCount: courseCount[0]?.count ?? 0,
    stripeProductId: creator.stripeProductId ?? null,
    stripePriceId: creator.stripePriceId ?? null,
    createdAt: creator.createdAt,
  });
});

router.post("/me", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { name, bio, niche, monthlyPrice } = req.body;

  const existing = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });

  if (existing) {
    res.status(409).json({ error: "Creator profile already exists" });
    return;
  }

  const id = crypto.randomUUID();
  const [creator] = await db.insert(creatorsTable).values({
    id,
    userId: user.id,
    name,
    bio,
    niche,
    monthlyPrice: String(monthlyPrice ?? 9.99),
  }).returning();

  await db.update(usersTable).set({ role: "creator", roleSelected: true }).where(eq(usersTable.id, user.id));

  res.status(201).json({
    id: creator.id,
    userId: creator.userId,
    name: creator.name,
    bio: creator.bio ?? null,
    niche: creator.niche ?? null,
    avatarUrl: creator.avatarUrl ?? null,
    coverUrl: creator.coverUrl ?? null,
    monthlyPrice: parseFloat(creator.monthlyPrice as unknown as string),
    subscriberCount: 0,
    postCount: 0,
    courseCount: 0,
    stripeProductId: null,
    stripePriceId: null,
    createdAt: creator.createdAt,
  });
});

router.put("/me", requireAuth, requireCreator, async (req, res) => {
  const user = (req as any).dbUser;
  const { name, bio, niche, monthlyPrice, coverUrl, avatarUrl } = req.body;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  if (monthlyPrice !== undefined) {
    const price = Number(monthlyPrice);
    if (!Number.isFinite(price) || price < 0 || price > 1000) {
      res.status(400).json({ error: "monthlyPrice must be a number between 0 and 1000" });
      return;
    }
  }
  if (typeof name === "string" && name.length > 100) {
    res.status(400).json({ error: "name must be 100 characters or fewer" });
    return;
  }
  if (typeof bio === "string" && bio.length > 2000) {
    res.status(400).json({ error: "bio must be 2000 characters or fewer" });
    return;
  }

  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name;
  if (bio !== undefined) updates.bio = bio;
  if (niche !== undefined) updates.niche = niche;
  if (monthlyPrice !== undefined) updates.monthlyPrice = String(Number(monthlyPrice));
  if (coverUrl !== undefined) updates.coverUrl = coverUrl;
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

  const [updated] = await db
    .update(creatorsTable)
    .set(updates)
    .where(eq(creatorsTable.id, creator.id))
    .returning();

  if (avatarUrl !== undefined || name !== undefined) {
    const userUpdates: Record<string, any> = {};
    if (avatarUrl !== undefined) userUpdates.avatarUrl = avatarUrl;
    if (name !== undefined) userUpdates.name = name;
    await db.update(usersTable).set(userUpdates).where(eq(usersTable.id, user.id));
  }

  const [postCount, courseCount] = await Promise.all([
    db.select({ count: count() }).from(postsTable).where(eq(postsTable.creatorId, creator.id)),
    db.select({ count: count() }).from(coursesTable).where(eq(coursesTable.creatorId, creator.id)),
  ]);

  res.json({
    id: updated.id,
    userId: updated.userId,
    name: updated.name,
    bio: updated.bio ?? null,
    niche: updated.niche ?? null,
    avatarUrl: updated.avatarUrl ?? null,
    coverUrl: updated.coverUrl ?? null,
    monthlyPrice: parseFloat(updated.monthlyPrice as unknown as string),
    subscriberCount: updated.subscriberCount,
    postCount: postCount[0]?.count ?? 0,
    courseCount: courseCount[0]?.count ?? 0,
    stripeProductId: updated.stripeProductId ?? null,
    stripePriceId: updated.stripePriceId ?? null,
    createdAt: updated.createdAt,
  });
});

router.get("/me/dashboard", requireAuth, requireCreator, async (req, res) => {
  const user = (req as any).dbUser;
  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalRevenueRows, monthlyRevenueRows, newSubsRows, postCountRows, courseCountRows, lessonCountRows, recentPaymentsRows] = await Promise.all([
    db.select({ total: sql<string>`COALESCE(SUM(${paymentsTable.amount}), 0)` })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.creatorId, creator.id), eq(paymentsTable.status, "succeeded"))),
    db.select({ total: sql<string>`COALESCE(SUM(${paymentsTable.amount}), 0)` })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.creatorId, creator.id), eq(paymentsTable.status, "succeeded"), gte(paymentsTable.createdAt, startOfMonth))),
    db.select({ count: count() })
      .from(subscriptionsTable)
      .where(and(eq(subscriptionsTable.creatorId, creator.id), gte(subscriptionsTable.createdAt, startOfMonth))),
    db.select({ count: count() }).from(postsTable).where(eq(postsTable.creatorId, creator.id)),
    db.select({ count: count() }).from(coursesTable).where(eq(coursesTable.creatorId, creator.id)),
    db.select({ count: count() })
      .from(lessonsTable)
      .innerJoin(coursesTable, eq(lessonsTable.courseId, coursesTable.id))
      .where(eq(coursesTable.creatorId, creator.id)),
    db.query.paymentsTable.findMany({
      where: and(eq(paymentsTable.creatorId, creator.id), eq(paymentsTable.status, "succeeded")),
      orderBy: desc(paymentsTable.createdAt),
      limit: 5,
    }),
  ]);

  res.json({
    totalRevenue: parseFloat(totalRevenueRows[0]?.total ?? "0"),
    monthlyRevenue: parseFloat(monthlyRevenueRows[0]?.total ?? "0"),
    subscriberCount: creator.subscriberCount,
    newSubscribersThisMonth: newSubsRows[0]?.count ?? 0,
    totalPosts: postCountRows[0]?.count ?? 0,
    totalCourses: courseCountRows[0]?.count ?? 0,
    totalLessons: lessonCountRows[0]?.count ?? 0,
    recentPayments: recentPaymentsRows.map((p) => ({
      id: p.id,
      userId: p.userId,
      creatorId: p.creatorId ?? null,
      creatorName: creator.name,
      amount: parseFloat(p.amount as unknown as string),
      currency: p.currency,
      status: p.status,
      stripePaymentIntentId: p.stripePaymentIntentId ?? null,
      createdAt: p.createdAt,
    })),
  });
});

router.get("/me/analytics", requireAuth, requireCreator, async (req, res) => {
  const user = (req as any).dbUser;
  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const topPosts = await db.query.postsTable.findMany({
    where: eq(postsTable.creatorId, creator.id),
    orderBy: desc(postsTable.createdAt),
    limit: 5,
  });

  const months: { month: string; count: number }[] = [];
  const revenueByMonth: { month: string; amount: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const date = new Date();
    date.setMonth(date.getMonth() - i);
    const monthStr = date.toISOString().slice(0, 7);
    months.push({ month: monthStr, count: 0 });
    revenueByMonth.push({ month: monthStr, amount: 0 });
  }

  const subs = await db.query.subscriptionsTable.findMany({
    where: eq(subscriptionsTable.creatorId, creator.id),
    orderBy: desc(subscriptionsTable.createdAt),
  });

  for (const sub of subs) {
    const monthStr = sub.createdAt.toISOString().slice(0, 7);
    const entry = months.find((m) => m.month === monthStr);
    if (entry) entry.count++;
  }

  const payments = await db.query.paymentsTable.findMany({
    where: and(eq(paymentsTable.creatorId, creator.id), eq(paymentsTable.status, "succeeded")),
  });

  for (const p of payments) {
    const monthStr = p.createdAt.toISOString().slice(0, 7);
    const entry = revenueByMonth.find((m) => m.month === monthStr);
    if (entry) entry.amount += parseFloat(p.amount as unknown as string);
  }

  res.json({
    topPosts: topPosts.map((p) => ({
      id: p.id,
      creatorId: p.creatorId,
      creatorName: creator.name,
      creatorAvatarUrl: creator.avatarUrl ?? null,
      title: p.title ?? null,
      body: p.body ?? null,
      mediaUrl: p.mediaUrl ?? null,
      mediaType: p.mediaType ?? null,
      isLocked: p.isLocked,
      isBookmarked: false,
      moderationStatus: p.moderationStatus,
      createdAt: p.createdAt,
    })),
    subscriberGrowth: months,
    revenueByMonth,
  });
});

router.get("/me/posts", requireAuth, requireCreator, async (req, res) => {
  const user = (req as any).dbUser;
  const { limit = "50", offset = "0" } = req.query as Record<string, string>;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const posts = await db.query.postsTable.findMany({
    where: eq(postsTable.creatorId, creator.id),
    orderBy: desc(postsTable.createdAt),
    limit: Math.min(parseInt(limit) || 50, 200),
    offset: parseInt(offset) || 0,
  });

  res.json(posts.map((p) => ({
    id: p.id,
    creatorId: p.creatorId,
    title: p.title ?? null,
    body: p.body ?? null,
    mediaUrl: p.mediaUrl ?? null,
    thumbnailUrl: p.thumbnailUrl ?? null,
    mediaType: p.mediaType ?? null,
    isLocked: p.isLocked,
    moderationStatus: p.moderationStatus,
    moderationScore: p.moderationScore ?? null,
    createdAt: p.createdAt,
  })));
});

router.get("/:creatorId", async (req, res) => {
  const creatorId = req.params.creatorId as string;
  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.id, creatorId),
  });

  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const [postCount, courseCount, verificationRow] = await Promise.all([
    db.select({ count: count() }).from(postsTable).where(eq(postsTable.creatorId, creator.id)),
    db.select({ count: count() }).from(coursesTable).where(eq(coursesTable.creatorId, creator.id)),
    db.query.verificationsTable.findFirst({
      where: and(
        eq(verificationsTable.creatorId, creator.id),
        eq(verificationsTable.status, "approved"),
        or(isNull(verificationsTable.expiresAt), gt(verificationsTable.expiresAt, sql`now()`)),
      ),
    }),
  ]);

  res.json({
    id: creator.id,
    userId: creator.userId,
    name: creator.name,
    bio: creator.bio ?? null,
    niche: creator.niche ?? null,
    avatarUrl: creator.avatarUrl ?? null,
    coverUrl: creator.coverUrl ?? null,
    monthlyPrice: parseFloat(creator.monthlyPrice as unknown as string),
    subscriberCount: creator.subscriberCount,
    postCount: postCount[0]?.count ?? 0,
    courseCount: courseCount[0]?.count ?? 0,
    isVerified: !!verificationRow,
    stripeProductId: creator.stripeProductId ?? null,
    stripePriceId: creator.stripePriceId ?? null,
    createdAt: creator.createdAt,
  });
});

router.get("/:creatorId/posts", optionalAuth, async (req, res) => {
  const creatorId = req.params.creatorId as string;
  const { limit = "20", offset = "0" } = req.query as Record<string, string>;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.id, creatorId),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const dbUser = (req as any).dbUser;

  // Check if the requesting user is subscribed or is the creator themselves
  let canAccessLocked = false;
  if (dbUser) {
    if (creator.userId === dbUser.id) {
      canAccessLocked = true;
    } else {
      const sub = await db.query.subscriptionsTable.findFirst({
        where: and(
          eq(subscriptionsTable.userId, dbUser.id),
          eq(subscriptionsTable.creatorId, creatorId),
          eq(subscriptionsTable.status, "active"),
        ),
      });
      canAccessLocked = !!sub;
    }
  }

  const isAuthor = Boolean(dbUser && creator.userId === dbUser.id);
  const whereCondition = isAuthor
    ? eq(postsTable.creatorId, creatorId)
    : and(eq(postsTable.creatorId, creatorId), ne(postsTable.moderationStatus, "removed"));

  const posts = await db.query.postsTable.findMany({
    where: whereCondition,
    orderBy: desc(postsTable.createdAt),
    limit: Math.min(parseInt(limit) || 20, 100),
    offset: parseInt(offset) || 0,
  });

  res.json(posts.map((p) => {
    const access = !p.isLocked || canAccessLocked;
    return {
      id: p.id,
      creatorId: p.creatorId,
      creatorName: creator.name,
      creatorAvatarUrl: creator.avatarUrl ?? null,
      title: p.title ?? null,
      body: access ? p.body ?? null : null,
      mediaUrl: access ? p.mediaUrl ?? null : null,
      thumbnailUrl: p.thumbnailUrl ?? null,
      mediaType: p.mediaType ?? null,
      isLocked: p.isLocked,
      viewsCount: p.viewsCount ?? 0,
      isBookmarked: false,
      moderationStatus: p.moderationStatus,
      createdAt: p.createdAt,
    };
  }));
});

router.get("/:creatorId/courses", async (req, res) => {
  const creatorId = req.params.creatorId as string;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.id, creatorId),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const courses = await db.query.coursesTable.findMany({
    where: and(eq(coursesTable.creatorId, creatorId), eq(coursesTable.isPublished, true)),
    orderBy: desc(coursesTable.createdAt),
  });

  if (courses.length === 0) {
    res.json([]);
    return;
  }

  const courseIds = courses.map(c => c.id);
  const lessonCountRows = await db
    .select({ courseId: lessonsTable.courseId, cnt: count() })
    .from(lessonsTable)
    .where(inArray(lessonsTable.courseId, courseIds))
    .groupBy(lessonsTable.courseId);

  const lessonCountMap = new Map(lessonCountRows.map(r => [r.courseId, Number(r.cnt)]));

  res.json(courses.map(c => ({
    id: c.id,
    creatorId: c.creatorId,
    title: c.title,
    description: c.description ?? null,
    thumbnailUrl: c.thumbnailUrl ?? null,
    isPublished: c.isPublished,
    lessonCount: lessonCountMap.get(c.id) ?? 0,
    createdAt: c.createdAt,
  })));

});

export default router;
