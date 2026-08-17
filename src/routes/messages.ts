import { Router } from "express";
import { db } from "../db";
import { messagesTable, usersTable } from "../db";
import { eq, or, and, desc, sql } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { randomUUID } from "crypto";

const router = Router();

// ── GET /conversations ─────────────────────────────────────────────────────────
router.get("/conversations", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  const msgs = await db.query.messagesTable.findMany({
    where: or(eq(messagesTable.senderId, user.id), eq(messagesTable.receiverId, user.id)),
    orderBy: desc(messagesTable.createdAt),
  });

  const partnerIds = [...new Set(
    msgs.map(m => m.senderId === user.id ? m.receiverId : m.senderId),
  )];

  const partners = partnerIds.length > 0
    ? await db.query.usersTable.findMany({
        where: (u, { inArray }) => inArray(u.id, partnerIds),
      })
    : [];

  const conversations = partnerIds.map(pid => {
    const partner = partners.find(p => p.id === pid);
    const thread = msgs.filter(m => m.senderId === pid || m.receiverId === pid);
    const unread = thread.filter(m => m.receiverId === user.id && !m.isRead).length;
    return {
      partnerId: pid,
      partnerName: partner?.name ?? "Unknown",
      partnerAvatar: partner?.avatarUrl ?? null,
      lastMessage: thread[0]?.body ?? "",
      lastAt: thread[0]?.createdAt ?? null,
      unreadCount: unread,
    };
  });

  res.json(conversations);
});

// ── GET /unread/count — must come BEFORE /:partnerId ──────────────────────────
router.get("/unread/count", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(messagesTable)
    .where(and(eq(messagesTable.receiverId, user.id), eq(messagesTable.isRead, false)));
  res.json({ count: row?.count ?? 0 });
});

// ── POST / (send message) ──────────────────────────────────────────────────────
router.post("/", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { receiverId, body } = req.body;
  if (!receiverId || !body?.trim()) {
    res.status(400).json({ error: "receiverId and body are required" });
    return;
  }
  if (body.length > 5000) {
    res.status(400).json({ error: "Message must be 5000 characters or fewer" });
    return;
  }
  if (receiverId === user.id) {
    res.status(400).json({ error: "Cannot send a message to yourself" });
    return;
  }

  const receiver = await db.query.usersTable.findFirst({ where: eq(usersTable.id, receiverId) });
  if (!receiver) { res.status(404).json({ error: "Recipient not found" }); return; }

  const [msg] = await db
    .insert(messagesTable)
    .values({
      id: randomUUID(),
      senderId: user.id,
      receiverId,
      body: body.trim(),
      isRead: false,
    })
    .returning();

  res.status(201).json({
    id: msg.id,
    senderId: msg.senderId,
    receiverId: msg.receiverId,
    body: msg.body,
    isRead: msg.isRead,
    createdAt: msg.createdAt,
  });
});

// ── GET /:partnerId (conversation thread) ─────────────────────────────────────
router.get("/:partnerId", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const partnerId = req.params.partnerId as string;

  const msgs = await db.query.messagesTable.findMany({
    where: or(
      and(eq(messagesTable.senderId, user.id), eq(messagesTable.receiverId, partnerId)),
      and(eq(messagesTable.senderId, partnerId), eq(messagesTable.receiverId, user.id)),
    ),
    orderBy: desc(messagesTable.createdAt),
  });

  // Mark received messages as read
  await db
    .update(messagesTable)
    .set({ isRead: true })
    .where(
      and(eq(messagesTable.senderId, partnerId), eq(messagesTable.receiverId, user.id)),
    );

  res.json(msgs.reverse());
});

export default router;
