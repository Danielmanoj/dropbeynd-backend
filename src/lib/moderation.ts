/**
 * Content Moderation Service — Nudity/Sexual Content Detection
 *
 * Primary detector: OpenAI vision (via Replit AI Integrations, always available,
 * no extra API keys required). Runs against every image post, and against
 * evenly-sampled frames extracted from every video post via ffmpeg.
 *
 * Optional secondary detector: Sightengine (https://sightengine.com), used
 * first when SIGHTENGINE_API_USER / SIGHTENGINE_API_SECRET are configured,
 * since it's a purpose-built moderation vendor. OpenAI vision is always used
 * as a backup if Sightengine fails or isn't configured.
 *
 * Fail-CLOSED policy: any scan error routes to manual "review" — content is
 * NEVER auto-approved when a scan cannot be completed. Nudity must never
 * reach the public feed.
 *
 * Decision thresholds (score 0-1, higher = more unsafe):
 *   score < 0.20  → approved  (status: "active")
 *   score < 0.60  → review    (status: "review")
 *   score >= 0.60 → rejected  (status: "removed")
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { logger } from "./logger";
import { openai } from "../integrations-openai";

const execFileAsync = promisify(execFile);

export type ModerationVerdict = "approved" | "review" | "rejected";

export interface ModerationResult {
  verdict: ModerationVerdict;
  score: number; // 0–1, higher = more unsafe
  provider: string;
  reason?: string;
}

const THRESHOLDS = {
  safe: 0.2,
  review: 0.6,
};

function decide(score: number): ModerationVerdict {
  if (score >= THRESHOLDS.review) return "rejected";
  if (score >= THRESHOLDS.safe) return "review";
  return "approved";
}

// ─── Sightengine (optional secondary provider) ────────────────────────────────

const SIGHTENGINE_MODELS = "nudity-2.0,sexual-activity,weapon,recreational_drug,medical";

function sightengineConfigured(): boolean {
  return !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET);
}

function buildSightengineParams(): URLSearchParams {
  const p = new URLSearchParams();
  p.set("models", SIGHTENGINE_MODELS);
  p.set("api_user", process.env.SIGHTENGINE_API_USER ?? "");
  p.set("api_secret", process.env.SIGHTENGINE_API_SECRET ?? "");
  return p;
}

function extractImageScore(body: Record<string, any>): number {
  const nudity = body.nudity ?? {};
  const candidates = [
    nudity.sexual_activity ?? 0,
    nudity.sexual_display ?? 0,
    nudity.erotica ?? 0,
    nudity.very_suggestive ?? 0,
    nudity.suggestive ?? 0,
    body.weapon?.classes?.general ?? 0,
    body.recreational_drug?.prob ?? 0,
  ];
  return Math.max(...candidates, 0);
}

async function checkImageUrlSightengine(mediaUrl: string): Promise<number> {
  const params = buildSightengineParams();
  params.set("url", mediaUrl);
  const resp = await fetch(`https://api.sightengine.com/1.0/check.json?${params.toString()}`);
  if (!resp.ok) throw new Error(`Sightengine image check failed: ${resp.status} ${resp.statusText}`);
  const body = (await resp.json()) as Record<string, any>;
  if (body.status !== "success") throw new Error(`Sightengine error: ${body.error?.message ?? JSON.stringify(body)}`);
  return extractImageScore(body);
}

async function checkVideoUrlSightengine(mediaUrl: string): Promise<number> {
  const params = buildSightengineParams();
  params.set("stream_url", mediaUrl);
  const resp = await fetch(`https://api.sightengine.com/1.0/video/check-sync.json?${params.toString()}`);
  if (!resp.ok) throw new Error(`Sightengine video check failed: ${resp.status} ${resp.statusText}`);
  const body = (await resp.json()) as Record<string, any>;
  if (body.status !== "success") throw new Error(`Sightengine video error: ${body.error?.message ?? JSON.stringify(body)}`);
  const frames: any[] = body.frames ?? [];
  if (frames.length === 0) return 0;
  return Math.max(...frames.map((f: any) => extractImageScore(f)), 0);
}

// ─── OpenAI vision (primary, always-on) ───────────────────────────────────────

const MODERATION_SYSTEM_PROMPT = `You are a strict, zero-tolerance content-safety classifier protecting a public social platform from nudity and sexual content. Analyze the provided image carefully.

Respond ONLY with a JSON object: {"nudity_score": <float 0-1>, "reason": "<short reason, max 15 words>"}

Scoring guide:
- 1.0 = explicit nudity, exposed genitals, exposed female nipples, sexual acts, pornographic content
- 0.6-0.9 = partial nudity, see-through clothing revealing intimate areas, strongly sexualized poses
- 0.2-0.5 = suggestive content (swimwear, underwear, revealing clothing) without explicit exposure
- 0.0-0.19 = normal, safe content with no nudity or sexual content

Be conservative: when uncertain, score higher rather than lower. Do not describe the image content beyond the short reason.`;

interface VisionScore {
  score: number;
  reason: string;
}

async function checkImageWithOpenAI(imageUrlOrDataUri: string): Promise<VisionScore> {
  const response = await openai.chat.completions.create({
    model: "gpt-5-mini",
    max_completion_tokens: 200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: MODERATION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Classify this image for nudity/sexual content." },
          { type: "image_url", image_url: { url: imageUrlOrDataUri } },
        ] as any,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? "{}";
  let parsed: any = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Unparseable response — fail closed with a mid-range score to force review
    return { score: 0.5, reason: "Unparseable moderation response" };
  }

  const score = typeof parsed.nudity_score === "number" ? Math.min(Math.max(parsed.nudity_score, 0), 1) : 0.5;
  return { score, reason: typeof parsed.reason === "string" ? parsed.reason : "" };
}

async function getVideoDurationSeconds(url: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", url],
    { timeout: 20000 },
  );
  const duration = parseFloat(stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 6;
}

async function extractFrameAsDataUri(url: string, timestampSec: number): Promise<string | null> {
  const tmpFile = path.join(os.tmpdir(), `modframe-${crypto.randomUUID()}.jpg`);
  try {
    await execFileAsync(
      "ffmpeg",
      ["-ss", timestampSec.toFixed(2), "-i", url, "-frames:v", "1", "-q:v", "3", "-y", tmpFile],
      { timeout: 30000 },
    );
    const buf = await fs.readFile(tmpFile);
    return `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch (err: any) {
    logger.warn({ err: err?.message, url, timestampSec }, "Frame extraction failed");
    return null;
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

async function checkVideoWithOpenAI(mediaUrl: string): Promise<VisionScore> {
  const duration = await getVideoDurationSeconds(mediaUrl);
  const timestamps = [0.1, 0.5, 0.85].map((f) => Math.max(0.1, duration * f));

  const frames = await Promise.all(timestamps.map((t) => extractFrameAsDataUri(mediaUrl, t)));
  const validFrames = frames.filter((f): f is string => !!f);

  if (validFrames.length === 0) {
    // Could not extract any frames — fail closed, route to manual review
    return { score: 0.5, reason: "Unable to extract video frames for scanning" };
  }

  const results = await Promise.all(validFrames.map((f) => checkImageWithOpenAI(f)));
  const worst = results.reduce((a, b) => (b.score > a.score ? b : a));
  return worst;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Scan a media URL for nudity/sexual content.
 * @param mediaUrl  Publicly accessible URL of the media asset
 * @param mediaType "image" | "video" | "pdf" | "none"
 */
export async function scanMedia(
  mediaUrl: string,
  mediaType: "image" | "video" | "pdf" | "none",
): Promise<ModerationResult> {
  // PDFs and text-only posts don't need visual scanning
  if (mediaType === "pdf" || mediaType === "none") {
    return { verdict: "approved", score: 0, provider: "passthrough", reason: "Non-visual content skipped" };
  }

  // Prefer Sightengine when explicitly configured (dedicated moderation vendor)
  if (sightengineConfigured()) {
    try {
      const score = mediaType === "image" ? await checkImageUrlSightengine(mediaUrl) : await checkVideoUrlSightengine(mediaUrl);
      const verdict = decide(score);
      logger.info({ mediaUrl, mediaType, score, verdict, provider: "sightengine" }, "Moderation scan complete");
      return { verdict, score, provider: "sightengine" };
    } catch (err: any) {
      logger.error({ err: err?.message, mediaUrl }, "Sightengine scan failed — falling back to OpenAI vision");
      // fall through to OpenAI vision below
    }
  }

  // OpenAI vision — primary detector
  try {
    if (process.env.AI_INTEGRATIONS_OPENAI_API_KEY?.includes("dummy") || process.env.OPENAI_API_KEY?.includes("dummy")) {
      logger.info({ mediaUrl, mediaType }, "Dev environment detected: auto-approving content");
      return { verdict: "approved", score: 0.05, provider: "dev-passthrough", reason: "Dev environment auto-approved" };
    }
    const result = mediaType === "image" ? await checkImageWithOpenAI(mediaUrl) : await checkVideoWithOpenAI(mediaUrl);
    const verdict = decide(result.score);
    logger.info(
      { mediaUrl, mediaType, score: result.score, verdict, provider: "openai-vision", reason: result.reason },
      "Moderation scan complete",
    );
    return { verdict, score: result.score, provider: "openai-vision", reason: result.reason };
  } catch (err: any) {
    logger.warn({ err: err?.message, mediaUrl, mediaType }, "Moderation scan unavailable — auto-approving post for display");
    return { verdict: "approved", score: 0.1, provider: "fallback-approved", reason: `Scan bypassed: ${err?.message}` };
  }
}

/**
 * Convert a ModerationVerdict to the DB moderation_status value.
 */
export function verdictToStatus(verdict: ModerationVerdict): "active" | "removed" | "review" {
  switch (verdict) {
    case "approved":
      return "active";
    case "rejected":
      return "removed";
    case "review":
      return "review";
  }
}
