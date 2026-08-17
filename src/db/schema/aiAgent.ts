import { pgTable, text, timestamp, pgEnum, jsonb } from "drizzle-orm/pg-core";

export const agentScanTypeEnum = pgEnum("agent_scan_type", [
  "system",
  "security",
  "performance",
  "database",
  "ui_ux",
]);

export const agentScanStatusEnum = pgEnum("agent_scan_status", [
  "running",
  "completed",
  "failed",
]);

export const agentSeverityEnum = pgEnum("agent_severity", [
  "critical",
  "high",
  "medium",
  "low",
  "info",
]);

export const agentScansTable = pgTable("agent_scans", {
  id: text("id").primaryKey().notNull(),
  type: agentScanTypeEnum("type").notNull(),
  status: agentScanStatusEnum("status").default("running").notNull(),
  summary: text("summary"),
  stats: jsonb("stats"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const agentLogsTable = pgTable("agent_logs", {
  id: text("id").primaryKey().notNull(),
  scanId: text("scan_id").notNull().references(() => agentScansTable.id, { onDelete: "cascade" }),
  level: text("level").notNull().default("info"),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const agentReportsTable = pgTable("agent_reports", {
  id: text("id").primaryKey().notNull(),
  scanId: text("scan_id").notNull().references(() => agentScansTable.id, { onDelete: "cascade" }),
  severity: agentSeverityEnum("severity").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  suggestedFix: text("suggested_fix"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AgentScan = typeof agentScansTable.$inferSelect;
export type AgentLog = typeof agentLogsTable.$inferSelect;
export type AgentReport = typeof agentReportsTable.$inferSelect;
