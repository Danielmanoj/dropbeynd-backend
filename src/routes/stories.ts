import { Router } from "express";
import { db } from "../db";
import { storiesTable, creatorsTable } from "../db";
import { eq, gt, desc } from "drizzle-orm";
import { requireAuth, requireCreator, optionalAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

router.get("/", optionalAuth, async (_req, res) => {
  const now = new Date();

  const stories = await db.query.storiesTable.findMany({
    where: gt(storiesTable.expiresAt, now),
    orderBy: desc(storiesTable.createdAt),
    with: { creator: true },
    limit: 30,
  });

  const grouped: Record<string, any> = {};
  for (const s of stories) {
    const c = (s as any).creator;
    if (!c) continue;
    if (!grouped[c.id]) {
      grouped[c.id] = {
        creatorId: c.id,
        creatorName: c.name,
        creatorAvatarUrl: c.avatarUrl ?? null,
        stories: [],
      };
    }
    grouped[c.id].stories.push({
      id: s.id,
      mediaUrl: s.mediaUrl,
      mediaType: s.mediaType,
      expiresAt: s.expiresAt,
      createdAt: s.createdAt,
    });
  }

  res.json(Object.values(grouped));
});

router.post("/", requireAuth, requireCreator, async (req, res) => {
  const user = (req as any).dbUser;
  const { mediaUrl, mediaType } = req.body;

  if (!mediaUrl) {
    res.status(400).json({ error: "mediaUrl is required" });
    return;
  }

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });
  if (!creator) {
    res.status(403).json({ error: "Creator profile required" });
    return;
  }

  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [story] = await db.insert(storiesTable).values({
    id,
    creatorId: creator.id,
    mediaUrl,
    mediaType: mediaType ?? "image",
    expiresAt,
  }).returning();

  res.status(201).json({
    id: story.id,
    creatorId: story.creatorId,
    mediaUrl: story.mediaUrl,
    mediaType: story.mediaType,
    expiresAt: story.expiresAt,
    createdAt: story.createdAt,
  });
});

export default router;
