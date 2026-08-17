import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "../db";
import { userUploadLimitsTable } from "../db";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { requireAuth } from "../lib/auth";
import { generateSignedUploadParams, isCloudinaryConfigured, type CloudinaryResourceType } from "../lib/cloudinary";

// ─── Daily upload limit (shared logic with storage.ts, DB-backed) ─────────────

const DAILY_LIMIT = 20;

function todayUTC(): string {
  return new Date().toISOString().split("T")[0];
}

async function checkLimit(userId: string): Promise<{ allowed: boolean; remaining: number }> {
  const today = todayUTC();
  const row = await db.query.userUploadLimitsTable.findFirst({
    where: and(eq(userUploadLimitsTable.userId, userId), eq(userUploadLimitsTable.date, today)),
  });
  const used = row?.uploadCount ?? 0;
  const remaining = DAILY_LIMIT - used;
  return { allowed: remaining > 0, remaining };
}

async function incrementLimit(userId: string): Promise<number> {
  const today = todayUTC();
  const existing = await db.query.userUploadLimitsTable.findFirst({
    where: and(eq(userUploadLimitsTable.userId, userId), eq(userUploadLimitsTable.date, today)),
  });

  if (!existing) {
    await db.insert(userUploadLimitsTable).values({
      id: crypto.randomUUID(),
      userId,
      uploadCount: 1,
      date: today,
    });
    return DAILY_LIMIT - 1;
  }

  const newCount = existing.uploadCount + 1;
  await db
    .update(userUploadLimitsTable)
    .set({ uploadCount: newCount, updatedAt: new Date() })
    .where(eq(userUploadLimitsTable.id, existing.id));
  return DAILY_LIMIT - newCount;
}

// ─── Per-type validation rules ────────────────────────────────────────────────

type UploadType = "profile" | "cover" | "post" | "course";

const UPLOAD_RULES: Record<UploadType, { allowedTypes: string[]; maxMB: number; folder: string }> = {
  profile: { allowedTypes: ["image/jpeg", "image/png", "image/webp"], maxMB: 2, folder: "creatorhub/profiles" },
  cover: { allowedTypes: ["image/jpeg", "image/png", "image/webp"], maxMB: 5, folder: "creatorhub/covers" },
  post: {
    allowedTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"],
    maxMB: 50,
    folder: "creatorhub/posts",
  },
  course: {
    allowedTypes: [
      "video/mp4", "video/quicktime",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    maxMB: 100,
    folder: "creatorhub/courses",
  },
};

function resourceTypeFor(contentType: string): CloudinaryResourceType {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return "raw";
}

const SignBody = z.object({
  uploadType: z.enum(["profile", "cover", "post", "course"]),
  contentType: z.string().min(1),
  size: z.number().int().min(1),
});

const router: IRouter = Router();

/** POST /storage/cloudinary/sign — returns signed params for a direct browser→Cloudinary upload */
router.post("/storage/cloudinary/sign", requireAuth, async (req: Request, res: Response) => {
  if (!isCloudinaryConfigured()) {
    res.status(503).json({ error: "Cloudinary storage is not configured on this server." });
    return;
  }

  const parsed = SignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid fields: uploadType, contentType, size are required" });
    return;
  }
  const { uploadType, contentType, size } = parsed.data;
  const rules = UPLOAD_RULES[uploadType];

  if (!rules.allowedTypes.includes(contentType)) {
    const allowed = rules.allowedTypes.map((t) => t.split("/")[1]).join(", ");
    res.status(422).json({ error: `Invalid file type for ${uploadType} upload. Allowed: ${allowed}` });
    return;
  }
  if (size > rules.maxMB * 1024 * 1024) {
    res.status(422).json({ error: `File too large. Max ${rules.maxMB}MB for ${uploadType} uploads.` });
    return;
  }

  const user = (req as any).dbUser;
  const { allowed, remaining } = await checkLimit(user.id);
  if (!allowed) {
    res.status(429).json({ error: "Upload limit reached. Try again tomorrow.", retryAfter: "tomorrow" });
    return;
  }

  try {
    const resourceType = resourceTypeFor(contentType);
    const signed = generateSignedUploadParams(rules.folder, resourceType);
    const remainingAfter = await incrementLimit(user.id);

    req.log.info(
      { uploadType, contentType, sizeMB: (size / 1024 / 1024).toFixed(2), remaining: remainingAfter },
      "Cloudinary upload signature issued",
    );

    res.json({ ...signed, remainingToday: remainingAfter });
  } catch (error) {
    req.log.error({ err: error }, "Error generating Cloudinary signature");
    res.status(500).json({ error: "Failed to generate upload signature" });
  }
});

/** GET /storage/cloudinary/status — lets the client know whether Cloudinary is available */
router.get("/storage/cloudinary/status", (_req: Request, res: Response) => {
  res.json({ configured: isCloudinaryConfigured() });
});

export default router;
