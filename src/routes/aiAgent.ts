/**
 * AI Engineering Agent routes
 *
 * POST /ai-agent/scan        — start a scan (system/security/performance/database/ui_ux)
 * GET  /ai-agent/scans       — list past scans
 * GET  /ai-agent/scans/:id   — scan detail with logs + reports
 * DELETE /ai-agent/scans/:id — delete a scan
 */

import { Router } from "express";
import { db } from "../db";
import {
  agentScansTable,
  agentLogsTable,
  agentReportsTable,
  usersTable,
  creatorsTable,
  postsTable,
  subscriptionsTable,
  paymentsTable,
  ticketsTable,
  reportsTable,
  notificationsTable,
} from "../db";
import { eq, desc, count, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { openai } from "../integrations-openai";
import crypto from "crypto";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function addLog(scanId: string, level: string, message: string) {
  await db.insert(agentLogsTable).values({
    id: crypto.randomUUID(),
    scanId,
    level,
    message,
  });
}

async function addReport(
  scanId: string,
  severity: "critical" | "high" | "medium" | "low" | "info",
  title: string,
  description: string,
  category: string,
  suggestedFix?: string,
) {
  await db.insert(agentReportsTable).values({
    id: crypto.randomUUID(),
    scanId,
    severity,
    title,
    description,
    category,
    suggestedFix: suggestedFix ?? null,
  });
}

// ─── Collectors ───────────────────────────────────────────────────────────────

async function collectSystemStats() {
  const [
    userCount,
    creatorCount,
    postCount,
    subCount,
    activeSubCount,
    ticketCount,
    reportCount,
    flaggedCount,
    revenue,
  ] = await Promise.all([
    db.select({ c: count() }).from(usersTable),
    db.select({ c: count() }).from(creatorsTable),
    db.select({ c: count() }).from(postsTable),
    db.select({ c: count() }).from(subscriptionsTable),
    db.select({ c: count() }).from(subscriptionsTable).where(eq(subscriptionsTable.status, "active")),
    db.select({ c: count() }).from(ticketsTable).where(eq(ticketsTable.status, "open")),
    db.select({ c: count() }).from(reportsTable),
    db.select({ c: count() }).from(postsTable).where(eq(postsTable.moderationStatus, "flagged")),
    db.select({ total: sql<string>`coalesce(sum(amount), 0)` }).from(paymentsTable).where(eq(paymentsTable.status, "succeeded")),
  ]);

  return {
    users: userCount[0].c,
    creators: creatorCount[0].c,
    posts: postCount[0].c,
    totalSubscriptions: subCount[0].c,
    activeSubscriptions: activeSubCount[0].c,
    openTickets: ticketCount[0].c,
    reportedContent: reportCount[0].c,
    flaggedPosts: flaggedCount[0].c,
    totalRevenueCents: parseInt(revenue[0].total ?? "0"),
  };
}

async function runSystemScan(scanId: string) {
  await addLog(scanId, "info", "▶ Starting full system scan...");
  await addLog(scanId, "info", "Collecting platform statistics from database...");

  const stats = await collectSystemStats();
  await addLog(scanId, "success", `✓ Database responsive — ${stats.users} users, ${stats.creators} creators, ${stats.posts} posts`);
  await addLog(scanId, "info", `Active subscriptions: ${stats.activeSubscriptions} / ${stats.totalSubscriptions}`);
  await addLog(scanId, "info", `Revenue collected: $${(stats.totalRevenueCents / 100).toFixed(2)}`);

  if (stats.flaggedPosts > 0) {
    await addLog(scanId, "warning", `⚠ ${stats.flaggedPosts} post(s) currently flagged and awaiting moderation`);
  }
  if (stats.openTickets > 0) {
    await addLog(scanId, "warning", `⚠ ${stats.openTickets} support ticket(s) unresolved`);
  }

  await addLog(scanId, "info", "Checking environment configuration...");
  const envChecks = [
    { key: "CLERK_PUBLISHABLE_KEY", label: "Clerk Auth" },
    { key: "CLERK_SECRET_KEY", label: "Clerk Secret" },
    { key: "DATABASE_URL", label: "Database URL" },
    { key: "SESSION_SECRET", label: "Session Secret" },
    { key: "STRIPE_SECRET_KEY", label: "Stripe Payments" },
    { key: "AI_INTEGRATIONS_OPENAI_BASE_URL", label: "AI Integration" },
  ];
  const missingEnv: string[] = [];
  for (const check of envChecks) {
    if (process.env[check.key]) {
      await addLog(scanId, "success", `✓ ${check.label} — configured`);
    } else {
      await addLog(scanId, "warning", `⚠ ${check.label} — not configured`);
      missingEnv.push(check.label);
    }
  }

  await addLog(scanId, "info", "Analyzing system data with AI...");

  const aiPrompt = `You are an expert platform engineer auditing a creator economy SaaS platform (CreatorHub).

Platform stats:
- Users: ${stats.users}
- Creators: ${stats.creators}
- Posts: ${stats.posts}
- Active subscriptions: ${stats.activeSubscriptions} / ${stats.totalSubscriptions}
- Total revenue (cents): ${stats.totalRevenueCents}
- Open support tickets: ${stats.openTickets}
- Flagged posts pending moderation: ${stats.flaggedPosts}
- Missing config: ${missingEnv.join(", ") || "none"}

Generate a JSON array of findings. Each item: { severity: "critical"|"high"|"medium"|"low"|"info", title: string, description: string, category: string, suggestedFix: string }. Max 6 items. Focus on real actionable insights based on the data.`;

  const aiResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a platform engineering expert. Always respond with valid JSON only, no markdown fences." },
      { role: "user", content: aiPrompt },
    ],
    temperature: 0.3,
  });

  const rawJson = aiResponse.choices[0]?.message?.content ?? "[]";
  let findings: any[] = [];
  try { findings = JSON.parse(rawJson); } catch { findings = []; }

  for (const f of findings) {
    await addReport(scanId, f.severity ?? "info", f.title, f.description, f.category ?? "system", f.suggestedFix);
    await addLog(scanId, f.severity === "critical" || f.severity === "high" ? "error" : "info", `[${(f.severity ?? "info").toUpperCase()}] ${f.title}`);
  }

  await addLog(scanId, "success", `✓ System scan complete — ${findings.length} findings generated`);
  return stats;
}

async function runSecurityScan(scanId: string) {
  await addLog(scanId, "info", "▶ Starting security audit...");
  const findings: any[] = [];

  await addLog(scanId, "info", "Checking authentication configuration...");
  if (!process.env.CLERK_SECRET_KEY) {
    findings.push({ severity: "critical", title: "Clerk Secret Key Missing", description: "Authentication is not properly configured without CLERK_SECRET_KEY.", category: "auth", suggestedFix: "Set CLERK_SECRET_KEY in environment secrets." });
    await addLog(scanId, "error", "✗ CLERK_SECRET_KEY not found");
  } else {
    await addLog(scanId, "success", "✓ Clerk authentication keys present");
  }

  await addLog(scanId, "info", "Checking payment security...");
  if (!process.env.STRIPE_SECRET_KEY) {
    findings.push({ severity: "high", title: "Stripe Not Configured", description: "Platform operates in demo mode — no real payment processing.", category: "payments", suggestedFix: "Add STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to enable real Stripe payments." });
    await addLog(scanId, "warning", "⚠ Stripe keys absent — demo mode active");
  } else {
    await addLog(scanId, "success", "✓ Stripe payment keys configured");
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      findings.push({ severity: "medium", title: "Stripe Webhook Secret Missing", description: "Webhook signature verification is disabled, making webhooks vulnerable to spoofing.", category: "payments", suggestedFix: "Set STRIPE_WEBHOOK_SECRET to verify webhook signatures." });
      await addLog(scanId, "warning", "⚠ STRIPE_WEBHOOK_SECRET not set — webhook verification disabled");
    }
  }

  await addLog(scanId, "info", "Checking session configuration...");
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
    findings.push({ severity: "high", title: "Weak Session Secret", description: "SESSION_SECRET is missing or too short.", category: "auth", suggestedFix: "Set a strong 32+ character SESSION_SECRET." });
    await addLog(scanId, "error", "✗ SESSION_SECRET too short or missing");
  } else {
    await addLog(scanId, "success", "✓ Session secret configured");
  }

  await addLog(scanId, "info", "Checking admin access control...");
  const adminEmail = process.env.ADMIN_EMAIL ?? "danielmanoj20004@gmail.com";
  await addLog(scanId, "info", `Admin email hardcoded: ${adminEmail}`);
  findings.push({ severity: "low", title: "Hardcoded Admin Email", description: `Admin access is tied to a hardcoded email (${adminEmail}). Consider a more robust RBAC system for production.`, category: "auth", suggestedFix: "Implement a proper role management UI rather than relying on a hardcoded email." });

  await addLog(scanId, "info", "Checking database exposure...");
  if (process.env.DATABASE_URL?.includes("localhost") || process.env.DATABASE_URL?.includes("127.0.0.1")) {
    await addLog(scanId, "success", "✓ Database not publicly exposed (local)");
  } else {
    await addLog(scanId, "success", "✓ Database URL configured");
  }

  for (const f of findings) {
    await addReport(scanId, f.severity, f.title, f.description, f.category, f.suggestedFix);
  }
  await addLog(scanId, "success", `✓ Security audit complete — ${findings.length} findings`);
  return {};
}

async function runPerformanceScan(scanId: string) {
  await addLog(scanId, "info", "▶ Starting performance analysis...");

  await addLog(scanId, "info", "Measuring database query performance...");
  const start = Date.now();
  const stats = await collectSystemStats();
  const queryTime = Date.now() - start;
  await addLog(scanId, queryTime > 500 ? "warning" : "success", `DB stats query: ${queryTime}ms`);

  await addLog(scanId, "info", "Checking table sizes...");
  const tableSizes = await db.execute(sql`
    SELECT relname AS table_name, 
           pg_size_pretty(pg_total_relation_size(quote_ident(relname))) AS size,
           pg_total_relation_size(quote_ident(relname)) AS size_bytes
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(quote_ident(relname)) DESC
    LIMIT 10
  `);

  for (const row of (tableSizes as any).rows ?? []) {
    await addLog(scanId, "info", `Table "${row.table_name}": ${row.size}`);
  }

  await addLog(scanId, "info", "Analyzing with AI...");
  const aiPrompt = `You are a performance engineer analyzing a PostgreSQL-backed Node.js SaaS platform.

Query time for stats aggregation: ${queryTime}ms
Platform scale: ${stats.users} users, ${stats.posts} posts, ${stats.activeSubscriptions} active subscriptions

Generate 4-5 JSON findings about performance. Format: { severity: "critical"|"high"|"medium"|"low"|"info", title, description, category: "database"|"api"|"frontend"|"caching", suggestedFix }`;

  const aiRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a performance engineering expert. Return valid JSON only." },
      { role: "user", content: aiPrompt },
    ],
    temperature: 0.3,
  });

  let findings: any[] = [];
  try { findings = JSON.parse(aiRes.choices[0]?.message?.content ?? "[]"); } catch { findings = []; }

  for (const f of findings) {
    await addReport(scanId, f.severity ?? "info", f.title, f.description, f.category ?? "performance", f.suggestedFix);
    await addLog(scanId, "info", `[${(f.severity ?? "info").toUpperCase()}] ${f.title}`);
  }

  if (queryTime > 1000) {
    await addReport(scanId, "high", "Slow Database Aggregation", `Stats query took ${queryTime}ms which exceeds 1000ms threshold.`, "database", "Add database indexes on frequently queried columns and consider caching platform stats.");
  }

  await addLog(scanId, "success", `✓ Performance scan complete`);
  return stats;
}

async function runDatabaseScan(scanId: string) {
  await addLog(scanId, "info", "▶ Starting database integrity scan...");

  await addLog(scanId, "info", "Checking for orphaned records...");
  const orphanedPosts = await db.execute(sql`SELECT COUNT(*) as c FROM posts p LEFT JOIN creators c ON p.creator_id = c.id WHERE c.id IS NULL`);
  const orphanedCount = parseInt((orphanedPosts as any).rows?.[0]?.c ?? "0");

  if (orphanedCount > 0) {
    await addLog(scanId, "warning", `⚠ Found ${orphanedCount} post(s) with missing creator references`);
    await addReport(scanId, "medium", "Orphaned Posts Detected", `${orphanedCount} posts reference non-existent creators.`, "database", "Run a cleanup query: DELETE FROM posts WHERE creator_id NOT IN (SELECT id FROM creators)");
  } else {
    await addLog(scanId, "success", "✓ No orphaned posts found");
  }

  await addLog(scanId, "info", "Checking subscription integrity...");
  const expiredActive = await db.execute(sql`SELECT COUNT(*) as c FROM subscriptions WHERE status = 'active' AND current_period_end < NOW()`);
  const expiredCount = parseInt((expiredActive as any).rows?.[0]?.c ?? "0");

  if (expiredCount > 0) {
    await addLog(scanId, "warning", `⚠ ${expiredCount} subscriptions marked active but past period end`);
    await addReport(scanId, "medium", "Stale Active Subscriptions", `${expiredCount} subscriptions are marked active but have expired period end dates.`, "database", "Run a cleanup to update these to 'expired' status or sync with Stripe.");
  } else {
    await addLog(scanId, "success", "✓ Subscription statuses appear consistent");
  }

  await addLog(scanId, "info", "Checking user data completeness...");
  const incompleteUsers = await db.execute(sql`SELECT COUNT(*) as c FROM users WHERE name IS NULL OR name = ''`);
  const incompleteCount = parseInt((incompleteUsers as any).rows?.[0]?.c ?? "0");
  await addLog(scanId, "info", `Users with missing name: ${incompleteCount}`);

  await addLog(scanId, "info", "Checking indexes via pg_stat_user_indexes...");
  const indexes = await db.execute(sql`SELECT schemaname, tablename, indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename LIMIT 20`);
  await addLog(scanId, "info", `Found ${(indexes as any).rows?.length ?? 0} indexes in public schema`);

  await addLog(scanId, "info", "AI analysis of database health...");
  const aiPrompt = `Database health check for a creator platform:
- Orphaned posts: ${orphanedCount}
- Expired but active subscriptions: ${expiredCount}
- Users with missing names: ${incompleteCount}

Generate 3-4 JSON findings. Format: { severity, title, description, category: "database", suggestedFix }`;

  const aiRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Database expert. Return valid JSON array only." },
      { role: "user", content: aiPrompt },
    ],
    temperature: 0.2,
  });
  let findings: any[] = [];
  try { findings = JSON.parse(aiRes.choices[0]?.message?.content ?? "[]"); } catch { findings = []; }
  for (const f of findings) {
    await addReport(scanId, f.severity ?? "info", f.title, f.description, f.category ?? "database", f.suggestedFix);
  }

  await addLog(scanId, "success", "✓ Database scan complete");
  return {};
}

async function runUiScan(scanId: string) {
  await addLog(scanId, "info", "▶ Starting UI/UX audit...");
  await addLog(scanId, "info", "Analyzing platform structure and feature coverage...");

  const stats = await collectSystemStats();

  const aiPrompt = `You are a senior UX engineer and product manager auditing a creator economy platform (CreatorHub).

Platform features implemented:
- Netflix-style homepage with hero banner + content rows
- Creator profiles (LinkedIn-style with cover, avatar, follow/subscribe)
- Post interactions (like, comment, tip, report)
- Course system with lessons and progress tracking
- Subscription management (Stripe integration)
- Admin dashboard with moderation, verifications, tickets
- Inbox/messaging system
- Notifications system
- Browse page with niche filters
- Support ticket system

Platform scale: ${stats.users} users, ${stats.creators} creators, ${stats.posts} posts

Generate a JSON array of 5-6 UX improvements and feature suggestions. Format: { severity: "high"|"medium"|"low"|"info", title, description, category: "ux"|"feature"|"engagement"|"monetization"|"performance", suggestedFix }

Focus on actionable improvements that would meaningfully improve user retention and creator revenue.`;

  const aiRes = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a senior product engineer. Return valid JSON array only." },
      { role: "user", content: aiPrompt },
    ],
    temperature: 0.5,
  });
  let findings: any[] = [];
  try { findings = JSON.parse(aiRes.choices[0]?.message?.content ?? "[]"); } catch { findings = []; }

  for (const f of findings) {
    await addReport(scanId, f.severity ?? "info", f.title, f.description, f.category ?? "ux", f.suggestedFix);
    await addLog(scanId, "info", `[${(f.severity ?? "info").toUpperCase()}] ${f.title}`);
  }

  await addLog(scanId, "success", `✓ UI/UX audit complete — ${findings.length} suggestions generated`);
  return stats;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// POST /api/ai-agent/scan — trigger a scan
router.post("/scan", requireAuth, requireAdmin, async (req, res) => {
  const { type } = req.body as { type: string };
  const validTypes = ["system", "security", "performance", "database", "ui_ux"];
  if (!validTypes.includes(type)) {
    res.status(400).json({ error: "Invalid scan type" });
    return;
  }

  const scanId = crypto.randomUUID();
  const [scan] = await db.insert(agentScansTable).values({
    id: scanId,
    type: type as any,
    status: "running",
  }).returning();

  // Run scan async
  (async () => {
    try {
      let stats: any = {};
      if (type === "system") stats = await runSystemScan(scanId);
      else if (type === "security") stats = await runSecurityScan(scanId);
      else if (type === "performance") stats = await runPerformanceScan(scanId);
      else if (type === "database") stats = await runDatabaseScan(scanId);
      else if (type === "ui_ux") stats = await runUiScan(scanId);

      const reports = await db.select().from(agentReportsTable).where(eq(agentReportsTable.scanId, scanId));
      const critCount = reports.filter(r => r.severity === "critical").length;
      const highCount = reports.filter(r => r.severity === "high").length;
      const summary = `${reports.length} findings: ${critCount} critical, ${highCount} high. Scan completed successfully.`;

      await db.update(agentScansTable).set({
        status: "completed",
        summary,
        stats,
        completedAt: new Date(),
      }).where(eq(agentScansTable.id, scanId));
    } catch (err: any) {
      await db.update(agentScansTable).set({ status: "failed", summary: String(err?.message ?? "Unknown error") }).where(eq(agentScansTable.id, scanId));
    }
  })();

  res.json({ scanId, status: "running" });
});

// GET /api/ai-agent/scans
router.get("/scans", requireAuth, requireAdmin, async (_req, res) => {
  const scans = await db.select().from(agentScansTable).orderBy(desc(agentScansTable.createdAt)).limit(50);
  res.json(scans);
});

// GET /api/ai-agent/scans/:id
router.get("/scans/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id as string;
  const [scan] = await db.select().from(agentScansTable).where(eq(agentScansTable.id, id));
  if (!scan) { res.status(404).json({ error: "Scan not found" }); return; }

  const [logs, reports] = await Promise.all([
    db.select().from(agentLogsTable).where(eq(agentLogsTable.scanId, id as string)).orderBy(agentLogsTable.createdAt),
    db.select().from(agentReportsTable).where(eq(agentReportsTable.scanId, id as string)).orderBy(desc(agentReportsTable.createdAt)),
  ]);

  res.json({ ...scan, logs, reports });
});

// DELETE /api/ai-agent/scans/:id
router.delete("/scans/:id", requireAuth, requireAdmin, async (req, res) => {
  const id = req.params.id as string;
  await db.delete(agentScansTable).where(eq(agentScansTable.id, id));
  res.json({ success: true });
});

export default router;
