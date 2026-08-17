import { Router } from "express";
import { db } from "../db";
import { subscriptionsTable, creatorsTable } from "../db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  const subs = await db.query.subscriptionsTable.findMany({
    where: eq(subscriptionsTable.userId, user.id),
    with: { creator: true },
    orderBy: desc(subscriptionsTable.createdAt),
  });

  // Deduplicate — keep the most recent (active-preferred) subscription per creator
  const seen = new Map<string, typeof subs[0]>();
  for (const s of subs) {
    const existing = seen.get(s.creatorId);
    if (!existing || s.status === "active") {
      seen.set(s.creatorId, s);
    }
  }

  res.json([...seen.values()].map((s: any) => ({
    id: s.id,
    userId: s.userId,
    creatorId: s.creatorId,
    creatorName: s.creator?.name ?? "Unknown",
    creatorAvatarUrl: s.creator?.avatarUrl ?? null,
    monthlyPrice: parseFloat(s.creator?.monthlyPrice ?? "0"),
    status: s.status,
    currentPeriodEnd: s.currentPeriodEnd ?? null,
    stripeSubscriptionId: s.stripeSubscriptionId ?? null,
    createdAt: s.createdAt,
  })));
});

router.get("/:creatorId", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const creatorId = req.params.creatorId as string;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.id, creatorId),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const sub = await db.query.subscriptionsTable.findFirst({
    where: and(
      eq(subscriptionsTable.userId, user.id),
      eq(subscriptionsTable.creatorId, creatorId)
    ),
  });

  if (!sub) {
    res.json({
      id: "",
      userId: user.id,
      creatorId,
      creatorName: creator.name,
      creatorAvatarUrl: creator.avatarUrl ?? null,
      status: "expired",
      currentPeriodEnd: null,
      stripeSubscriptionId: null,
      createdAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    id: sub.id,
    userId: sub.userId,
    creatorId: sub.creatorId,
    creatorName: creator.name,
    creatorAvatarUrl: creator.avatarUrl ?? null,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
    stripeSubscriptionId: sub.stripeSubscriptionId ?? null,
    createdAt: sub.createdAt,
  });
});

export default router;
