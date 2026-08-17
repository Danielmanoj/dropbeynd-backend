import { Router } from "express";
import { db } from "../db";
import {
  paymentsTable,
  paymentMethodsTable,
  payoutAccountsTable,
  creatorsTable,
  subscriptionsTable,
} from "../db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import crypto from "crypto";

const router = Router();

router.post("/checkout", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { creatorId } = req.body;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.id, creatorId),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    const existing = await db.query.subscriptionsTable.findFirst({
      where: and(
        eq(subscriptionsTable.userId, user.id),
        eq(subscriptionsTable.creatorId, creatorId),
      ),
    });

    if (existing) {
      await db.update(subscriptionsTable)
        .set({ status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
        .where(eq(subscriptionsTable.id, existing.id));
    } else {
      const subId = crypto.randomUUID();
      const paymentId = crypto.randomUUID();

      await db.insert(subscriptionsTable).values({
        id: subId,
        userId: user.id,
        creatorId,
        status: "active",
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      await db.update(creatorsTable)
        .set({ subscriberCount: creator.subscriberCount + 1 })
        .where(eq(creatorsTable.id, creatorId));

      await db.insert(paymentsTable).values({
        id: paymentId,
        userId: user.id,
        creatorId,
        amount: creator.monthlyPrice as unknown as string,
        currency: "usd",
        status: "succeeded",
      });
    }

    res.json({ url: "/subscriptions", sessionId: "demo_session" }); return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

    const baseUrl = process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}`
      : "http://localhost";

    if (!creator.stripeProductId || !creator.stripePriceId) {
      const product = await stripe.products.create({
        name: `${creator.name} - Monthly Subscription`,
      });
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: Math.round(parseFloat(creator.monthlyPrice as unknown as string) * 100),
        currency: "usd",
        recurring: { interval: "month" },
      });

      await db.update(creatorsTable).set({
        stripeProductId: product.id,
        stripePriceId: price.id,
      }).where(eq(creatorsTable.id, creatorId));

      creator.stripeProductId = product.id;
      creator.stripePriceId = price.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: creator.stripePriceId!, quantity: 1 }],
      success_url: `${baseUrl}/subscriptions?success=1`,
      cancel_url: `${baseUrl}/creators/${creatorId}`,
      metadata: { userId: user.id, creatorId },
    });

    res.json({ url: session.url!, sessionId: session.id });
  } catch (err) {
    req.log.error({ err }, "Stripe checkout error");
    res.status(500).json({ error: "Payment processing failed" });
  }
});

router.post("/portal", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  if (!process.env.STRIPE_SECRET_KEY) {
    res.json({ url: "/subscriptions" }); return;
  }

  res.json({ url: "/subscriptions" });
});

router.get("/history", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;

  const payments = await db.query.paymentsTable.findMany({
    where: eq(paymentsTable.userId, user.id),
    orderBy: desc(paymentsTable.createdAt),
    with: { creator: true },
  });

  res.json(payments.map((p: any) => ({
    id: p.id,
    userId: p.userId,
    creatorId: p.creatorId ?? null,
    creatorName: p.creator?.name ?? null,
    amount: parseFloat(p.amount),
    currency: p.currency,
    status: p.status,
    stripePaymentIntentId: p.stripePaymentIntentId ?? null,
    createdAt: p.createdAt,
  })));
});

// ─── Payment Methods (Cards) ──────────────────────────────────────────────────

router.get("/methods", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const methods = await db.query.paymentMethodsTable.findMany({
    where: eq(paymentMethodsTable.userId, user.id),
    orderBy: desc(paymentMethodsTable.createdAt),
  });
  res.json(methods);
});

router.post("/methods", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { cardHolder, brand = "visa", last4, expMonth, expYear, isDefault = false } = req.body;

  if (!cardHolder || !last4 || !expMonth || !expYear) {
    res.status(400).json({ error: "Missing required card fields" });
    return;
  }

  if (isDefault) {
    await db.update(paymentMethodsTable)
      .set({ isDefault: false })
      .where(eq(paymentMethodsTable.userId, user.id));
  }

  const id = crypto.randomUUID();
  const [created] = await db.insert(paymentMethodsTable).values({
    id,
    userId: user.id,
    cardHolder,
    brand: String(brand).toLowerCase(),
    last4: String(last4).slice(-4),
    expMonth: String(expMonth).padStart(2, "0"),
    expYear: String(expYear),
    isDefault: !!isDefault,
  }).returning();

  res.status(201).json(created);
});

router.delete("/methods/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const methodId = req.params.id as string;

  await db.delete(paymentMethodsTable).where(
    and(eq(paymentMethodsTable.id, methodId), eq(paymentMethodsTable.userId, user.id))
  );

  res.status(204).send();
});

router.patch("/methods/:id/default", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const methodId = req.params.id as string;

  await db.update(paymentMethodsTable)
    .set({ isDefault: false })
    .where(eq(paymentMethodsTable.userId, user.id));

  const [updated] = await db.update(paymentMethodsTable)
    .set({ isDefault: true })
    .where(and(eq(paymentMethodsTable.id, methodId), eq(paymentMethodsTable.userId, user.id)))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Payment method not found" });
    return;
  }

  res.json(updated);
});

// ─── Payout Bank Accounts (Creators) ──────────────────────────────────────────

router.get("/payout-account", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const account = await db.query.payoutAccountsTable.findFirst({
    where: eq(payoutAccountsTable.userId, user.id),
    orderBy: desc(payoutAccountsTable.createdAt),
  });
  res.json(account ?? null);
});

router.post("/payout-account", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { bankName, accountHolderName, accountNumber, routingNumber, accountType = "checking", currency = "usd" } = req.body;

  if (!bankName || !accountHolderName || !accountNumber || !routingNumber) {
    res.status(400).json({ error: "Missing required bank details" });
    return;
  }

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, user.id),
  });

  const existing = await db.query.payoutAccountsTable.findFirst({
    where: eq(payoutAccountsTable.userId, user.id),
  });

  const last4 = String(accountNumber).slice(-4);

  if (existing) {
    const [updated] = await db.update(payoutAccountsTable)
      .set({
        bankName,
        accountHolderName,
        accountNumberLast4: last4,
        routingNumber,
        accountType,
        currency,
        creatorId: creator?.id ?? existing.creatorId,
      })
      .where(eq(payoutAccountsTable.id, existing.id))
      .returning();
    res.json(updated);
  } else {
    const id = crypto.randomUUID();
    const [created] = await db.insert(payoutAccountsTable).values({
      id,
      userId: user.id,
      creatorId: creator?.id ?? null,
      bankName,
      accountHolderName,
      accountNumberLast4: last4,
      routingNumber,
      accountType,
      currency,
      isDefault: true,
    }).returning();
    res.status(201).json(created);
  }
});

router.delete("/payout-account/:id", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const accountId = req.params.id as string;

  await db.delete(payoutAccountsTable).where(
    and(eq(payoutAccountsTable.id, accountId), eq(payoutAccountsTable.userId, user.id))
  );

  res.status(204).send();
});

// ─── Real-Time Direct Payment ─────────────────────────────────────────────────

router.post("/direct-pay", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { creatorId, amount } = req.body;

  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.id, creatorId),
  });
  if (!creator) {
    res.status(404).json({ error: "Creator not found" });
    return;
  }

  const chargeAmount = amount ? String(Number(amount).toFixed(2)) : String(creator.monthlyPrice);

  const existingSub = await db.query.subscriptionsTable.findFirst({
    where: and(
      eq(subscriptionsTable.userId, user.id),
      eq(subscriptionsTable.creatorId, creatorId),
    ),
  });

  if (existingSub) {
    await db.update(subscriptionsTable)
      .set({ status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) })
      .where(eq(subscriptionsTable.id, existingSub.id));
  } else {
    const subId = crypto.randomUUID();
    await db.insert(subscriptionsTable).values({
      id: subId,
      userId: user.id,
      creatorId,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    await db.update(creatorsTable)
      .set({ subscriberCount: creator.subscriberCount + 1 })
      .where(eq(creatorsTable.id, creatorId));
  }

  const paymentId = crypto.randomUUID();
  const [payment] = await db.insert(paymentsTable).values({
    id: paymentId,
    userId: user.id,
    creatorId,
    amount: chargeAmount,
    currency: "usd",
    status: "succeeded",
  }).returning();

  res.status(201).json({
    success: true,
    payment: {
      id: payment.id,
      creatorId: creator.id,
      creatorName: creator.name,
      amount: parseFloat(payment.amount as unknown as string),
      currency: payment.currency,
      status: payment.status,
      createdAt: payment.createdAt,
    },
  });
});

router.post("/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];

  if (!process.env.STRIPE_SECRET_KEY || !sig) {
    res.json({ received: true }); return;
  }

  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      event = req.body;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const { userId, creatorId } = session.metadata ?? {};
        if (userId && creatorId) {
          const subId = crypto.randomUUID();
          await db.insert(subscriptionsTable).values({
            id: subId,
            userId,
            creatorId,
            status: "active",
            stripeSubscriptionId: session.subscription,
            currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          }).onConflictDoNothing();

          const creator = await db.query.creatorsTable.findFirst({
            where: eq(creatorsTable.id, creatorId),
          });
          if (creator) {
            await db.update(creatorsTable)
              .set({ subscriberCount: creator.subscriberCount + 1 })
              .where(eq(creatorsTable.id, creatorId));
          }
        }
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await db.update(subscriptionsTable)
          .set({ status: "cancelled" })
          .where(eq(subscriptionsTable.stripeSubscriptionId, sub.id));
        break;
      }
    }

    res.json({ received: true });
  } catch (err) {
    req.log.error({ err }, "Webhook error");
    res.status(400).json({ error: "Webhook processing failed" });
  }
});

export default router;
