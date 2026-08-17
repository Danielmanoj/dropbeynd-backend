import { Router } from "express";
import { db } from "../db";
import { verificationsTable, creatorsTable } from "../db";
import { eq, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { randomUUID } from "crypto";

const router = Router();

// ─── POST /verifications/checkout ────────────────────────────────────────────
// Creates a $5 Stripe checkout session, or auto-submits in dev (no Stripe key).

router.post("/checkout", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const creator = await db.query.creatorsTable.findFirst({ where: eq(creatorsTable.userId, user.id) });
  if (!creator) { res.status(404).json({ error: "Creator profile not found. Become a creator first." }); return; }

  const existing = await db.query.verificationsTable.findFirst({
    where: eq(verificationsTable.creatorId, creator.id),
    orderBy: desc(verificationsTable.createdAt),
  });
  if (existing?.status === "pending") { res.status(409).json({ error: "Verification request already pending" }); return; }
  if (existing?.status === "approved") { res.status(409).json({ error: "Already verified" }); return; }

  // Dev mode — auto-submit for free
  if (!process.env.STRIPE_SECRET_KEY) {
    const [record] = await db.insert(verificationsTable).values({
      id: randomUUID(),
      creatorId: creator.id,
      requestedById: user.id,
      status: "pending",
    }).returning();
    res.status(201).json({ submitted: true, record });
    return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const baseUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : "http://localhost";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{
        price_data: {
          currency: "usd",
          product_data: {
            name: "CreatorHub Verified Badge",
            description: "Monthly verified badge subscription — cancel anytime",
          },
          unit_amount: 500,
          recurring: { interval: "month" },
        },
        quantity: 1,
      }],
      success_url: `${baseUrl}/creator/profile?ver_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/creator/profile`,
      metadata: { userId: user.id, creatorId: creator.id },
    });

    res.json({ url: session.url });
  } catch (err) {
    req.log.error({ err }, "Verification checkout error");
    res.status(500).json({ error: "Payment processing failed" });
  }
});

// ─── POST /verifications/verify-payment ──────────────────────────────────────
// Called after Stripe redirect — confirms payment and creates the request.

router.post("/verify-payment", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) { res.status(400).json({ error: "sessionId is required" }); return; }

  const creator = await db.query.creatorsTable.findFirst({ where: eq(creatorsTable.userId, user.id) });
  if (!creator) { res.status(404).json({ error: "Creator profile not found" }); return; }

  const existing = await db.query.verificationsTable.findFirst({
    where: eq(verificationsTable.creatorId, creator.id),
    orderBy: desc(verificationsTable.createdAt),
  });
  if (existing?.status === "pending") { res.status(409).json({ error: "Verification already pending" }); return; }
  if (existing?.status === "approved") { res.status(409).json({ error: "Already verified" }); return; }

  if (!process.env.STRIPE_SECRET_KEY) {
    res.status(400).json({ error: "Stripe not configured" }); return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status !== "complete") {
      res.status(402).json({ error: "Payment not completed" }); return;
    }
    // Prevent replaying someone else's successful sessionId to get verified
    // for free — the session must have been created for this exact user/creator.
    if (session.metadata?.userId !== user.id || session.metadata?.creatorId !== creator.id) {
      res.status(403).json({ error: "This payment session does not belong to your account" }); return;
    }

    const [record] = await db.insert(verificationsTable).values({
      id: randomUUID(),
      creatorId: creator.id,
      requestedById: user.id,
      status: "pending",
      stripePaymentIntentId: (session.subscription as string) ?? (session.payment_intent as string),
    }).returning();

    res.status(201).json(record);
  } catch (err) {
    req.log.error({ err }, "Verification payment confirmation error");
    res.status(500).json({ error: "Could not confirm payment" });
  }
});

// ─── POST /verifications/request ─────────────────────────────────────────────

router.post("/request", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const creator = await db.query.creatorsTable.findFirst({ where: eq(creatorsTable.userId, user.id) });
  if (!creator) { res.status(404).json({ error: "Creator profile not found. Become a creator first." }); return; }

  const existing = await db.query.verificationsTable.findFirst({
    where: eq(verificationsTable.creatorId, creator.id),
    orderBy: desc(verificationsTable.createdAt),
  });
  if (existing?.status === "pending") { res.status(409).json({ error: "Verification already pending" }); return; }
  if (existing?.status === "approved") { res.status(409).json({ error: "Already verified" }); return; }

  const [record] = await db.insert(verificationsTable).values({
    id: randomUUID(),
    creatorId: creator.id,
    requestedById: user.id,
    status: "pending",
  }).returning();
  res.status(201).json(record);
});

// ─── GET /verifications/my-status ────────────────────────────────────────────

router.get("/my-status", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const creator = await db.query.creatorsTable.findFirst({ where: eq(creatorsTable.userId, user.id) });
  if (!creator) { res.json({ status: null }); return; }
  const vr = await db.query.verificationsTable.findFirst({
    where: eq(verificationsTable.creatorId, creator.id),
    orderBy: desc(verificationsTable.createdAt),
  });
  res.json({ status: vr?.status ?? null, createdAt: vr?.createdAt ?? null });
});

// ─── GET /verifications/admin/all ────────────────────────────────────────────

router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
  const requests = await db.query.verificationsTable.findMany({
    orderBy: desc(verificationsTable.createdAt),
    with: { creator: true },
  });
  res.json(requests.map((r: any) => ({
    id: r.id,
    creatorId: r.creatorId,
    creatorName: r.creator?.name ?? "Unknown",
    creatorAvatarUrl: r.creator?.avatarUrl ?? null,
    creatorNiche: r.creator?.niche ?? null,
    status: r.status,
    paymentStatus: r.paymentStatus ?? null,
    stripePaymentIntentId: r.stripePaymentIntentId ?? null,
    adminNote: r.adminNote ?? null,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt ?? null,
    expiresAt: r.expiresAt ?? null,
  })));
});

// ─── PATCH /verifications/admin/:requestId ───────────────────────────────────

router.patch("/admin/:requestId", requireAuth, requireAdmin, async (req, res) => {
  const requestId = req.params.requestId as string;
  const { action, note } = req.body;
  if (!["approve", "reject", "revoke"].includes(action)) { res.status(400).json({ error: "Invalid action" }); return; }

  const now = new Date();
  let statusValue: "approved" | "rejected" | "revoked";
  let expiresAt: Date | null = null;

  if (action === "approve") {
    statusValue = "approved";
    // Badge valid for exactly 1 month from approval
    expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  } else if (action === "revoke") {
    statusValue = "revoked";
    expiresAt = now; // Immediately expired
  } else {
    statusValue = "rejected";
  }

  const [updated] = await db.update(verificationsTable)
    .set({ status: statusValue, adminNote: note, reviewedAt: now, expiresAt })
    .where(eq(verificationsTable.id, requestId))
    .returning();
  if (!updated) { res.status(404).json({ error: "Request not found" }); return; }

  res.json(updated);
});

export default router;
