import { Router } from "express";
import { db } from "../db";
import { postsTable, creatorsTable, coursesTable } from "../db";
import { eq, desc, and, count, ne } from "drizzle-orm";

const router = Router();

router.get("/content", async (req, res) => {
  const { filter, niche, limit = "20" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 20, 50);

  const conditions: any[] = [ne(postsTable.moderationStatus, "removed")];
  if (filter === "free") conditions.push(eq(postsTable.isLocked, false));
  if (filter === "premium") conditions.push(eq(postsTable.isLocked, true));

  const posts = await db.query.postsTable.findMany({
    where: and(...conditions),
    orderBy: desc(postsTable.createdAt),
    limit: lim,
    with: { creator: true },
  });

  const niched = niche
    ? posts.filter((p: any) => p.creator?.niche?.toLowerCase().includes(niche.toLowerCase()))
    : posts;

  res.json(niched.map((p: any) => ({
    id: p.id,
    creatorId: p.creatorId,
    creatorName: p.creator?.name ?? "Unknown",
    creatorAvatarUrl: p.creator?.avatarUrl ?? null,
    creatorNiche: p.creator?.niche ?? null,
    title: p.title ?? null,
    body: p.isLocked ? null : p.body,
    mediaUrl: p.isLocked ? null : p.mediaUrl,
    thumbnailUrl: p.thumbnailUrl ?? null,
    mediaType: p.mediaType ?? "none",
    isLocked: p.isLocked,
    moderationStatus: p.moderationStatus,
    createdAt: p.createdAt,
  })));
});

router.get("/creators", async (req, res) => {
  const { sort = "subscribers", niche, limit = "20" } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 20, 50);

  const creators = await db.query.creatorsTable.findMany({ limit: lim });

  let filtered = niche
    ? creators.filter(c => c.niche?.toLowerCase().includes(niche.toLowerCase()))
    : creators;

  if (sort === "new") {
    filtered = filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else {
    filtered = filtered.sort((a, b) => b.subscriberCount - a.subscriberCount);
  }

  const enriched = await Promise.all(filtered.map(async (c) => {
    const [postCount, courseCount] = await Promise.all([
      db.select({ count: count() }).from(postsTable).where(eq(postsTable.creatorId, c.id)),
      db.select({ count: count() }).from(coursesTable).where(eq(coursesTable.creatorId, c.id)),
    ]);
    return {
      id: c.id,
      userId: c.userId,
      name: c.name,
      bio: c.bio ?? null,
      niche: c.niche ?? null,
      avatarUrl: c.avatarUrl ?? null,
      coverUrl: c.coverUrl ?? null,
      monthlyPrice: parseFloat(c.monthlyPrice as unknown as string),
      subscriberCount: c.subscriberCount,
      postCount: Number(postCount[0]?.count ?? 0),
      courseCount: Number(courseCount[0]?.count ?? 0),
      createdAt: c.createdAt,
    };
  }));

  res.json(enriched);
});

export default router;
