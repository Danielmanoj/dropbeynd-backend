import { Router } from "express";
import { db } from "../db";
import { ticketsTable } from "../db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { randomUUID } from "crypto";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const tickets = await db.query.ticketsTable.findMany({
    where: eq(ticketsTable.userId, user.id),
    orderBy: desc(ticketsTable.createdAt),
  });
  res.json(tickets);
});

router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { subject, message, category } = req.body;
  if (!subject || !message) {
    res.status(400).json({ error: "subject and message required" });
    return;
  }
  const [ticket] = await db.insert(ticketsTable).values({
    id: randomUUID(),
    userId: user.id,
    subject,
    message,
    category: category ?? "other",
    status: "open",
  }).returning();
  res.status(201).json(ticket);
});

router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
  const tickets = await db.query.ticketsTable.findMany({
    orderBy: desc(ticketsTable.createdAt),
  });
  res.json(tickets);
});

router.patch("/:ticketId/reply", requireAuth, requireAdmin, async (req, res) => {
  const ticketId = req.params.ticketId as string;
  const { reply, status } = req.body;
  const [updated] = await db.update(ticketsTable)
    .set({ adminReply: reply, status: status ?? "resolved", updatedAt: new Date() })
    .where(eq(ticketsTable.id, ticketId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Ticket not found" }); return; }
  res.json(updated);
});

export default router;
