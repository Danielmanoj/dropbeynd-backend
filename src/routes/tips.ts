import { Router } from "express";
import { db } from "../db";
import { tipsTable, creatorsTable } from "../db";
import { eq, desc, sum } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { creatorId, amount, message } = req.body;

  if (!creatorId || !amount || Number(amount) < 1) {
    res.status(400).json({ error: "creatorId and amount (min $1) are required" });
    return;
  }

  const creator = await db.query.creatorsTable.findFirst({ where: eq(creatorsTable.id, creatorId) });
  if (!creator) { res.status(404).json({ error: "Creator not found" }); return; }

  const id = crypto.randomUUID();
  const [tip] = await db.insert(tipsTable).values({
    id, userId: user.id, creatorId, amount: String(amount), currency: "usd", message: message ?? null,
  }).returning();

  res.status(201).json({
    id: tip.id, creatorId: tip.creatorId, amount: tip.amount, currency: tip.currency,
    message: tip.message, createdAt: tip.createdAt,
  });
});

router.get("/creator/:creatorId", requireAuth, async (req, res) => {
  const creatorId = req.params.creatorId as string;
  const tips = await db.query.tipsTable.findMany({
    where: eq(tipsTable.creatorId, creatorId),
    orderBy: desc(tipsTable.createdAt),
    limit: 50,
    with: { user: true },
  });
  const [totals] = await db.select({ total: sum(tipsTable.amount) }).from(tipsTable).where(eq(tipsTable.creatorId, creatorId));
  res.json({ tips: tips.map(t => ({ ...t, userName: (t as any).user?.name ?? "Anonymous" })), totalTips: totals?.total ?? "0" });
});

export default router;
