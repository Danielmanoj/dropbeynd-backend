import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { z } from "zod";
import { db } from "../db";
import { userUploadLimitsTable } from "../db";
import { and, eq } from "drizzle-orm";
import crypto from "crypto";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../lib/auth";

// ─── Daily upload limit (DB-backed, resets at midnight UTC) ──────────────────

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

const UPLOAD_RULES: Record<UploadType, { allowedTypes: string[]; maxMB: number }> = {
  profile: {
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    maxMB: 2,
  },
  cover: {
    allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    maxMB: 5,
  },
  post: {
    allowedTypes: ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"],
    maxMB: 50,
  },
  course: {
    allowedTypes: [
      "video/mp4", "video/quicktime",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    maxMB: 100,
  },
};

const UploadBody = z.object({
  name: z.string().min(1),
  size: z.number().int().min(1),
  contentType: z.string().min(1),
});

function validateUpload(uploadType: UploadType, contentType: string, sizeBytes: number): string | null {
  const rules = UPLOAD_RULES[uploadType];
  if (!rules.allowedTypes.includes(contentType)) {
    const allowed = rules.allowedTypes.map(t => t.split("/")[1]).join(", ");
    return `Invalid file type for ${uploadType} upload. Allowed: ${allowed}`;
  }
  if (sizeBytes > rules.maxMB * 1024 * 1024) {
    return `File too large. Max ${rules.maxMB}MB for ${uploadType} uploads.`;
  }
  return null;
}

async function handleTypedUpload(
  uploadType: UploadType,
  req: Request,
  res: Response,
  storageService: ObjectStorageService,
) {
  const user = (req as any).dbUser;
  const parsed = UploadBody.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid fields: name, size, contentType are required" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  // Type + size validation
  const validationError = validateUpload(uploadType, contentType, size);
  if (validationError) {
    res.status(422).json({ error: validationError });
    return;
  }

  // Daily upload limit check
  const { allowed, remaining } = await checkLimit(user.id);
  if (!allowed) {
    res.status(429).json({
      error: "Upload limit reached. Try again tomorrow.",
      retryAfter: "tomorrow",
    });
    return;
  }

  try {
    const uploadURL = await storageService.getObjectEntityUploadURL();
    const objectPath = storageService.normalizeObjectEntityPath(uploadURL);
    const remainingAfter = await incrementLimit(user.id);

    req.log.info(
      { uploadType, contentType, sizeMB: (size / 1024 / 1024).toFixed(2), remaining: remainingAfter },
      "Upload URL issued"
    );

    res.json({ uploadURL, objectPath, uploadType, remainingToday: remainingAfter });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
}

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ─── Typed upload endpoints ───────────────────────────────────────────────────

/** POST /storage/uploads/profile — images only, max 2MB */
router.post("/storage/uploads/profile", requireAuth, (req, res) =>
  handleTypedUpload("profile", req, res, objectStorageService));

/** POST /storage/uploads/cover — banner/cover images only, max 5MB */
router.post("/storage/uploads/cover", requireAuth, (req, res) =>
  handleTypedUpload("cover", req, res, objectStorageService));

/** POST /storage/uploads/post — image or video, max 50MB */
router.post("/storage/uploads/post", requireAuth, (req, res) =>
  handleTypedUpload("post", req, res, objectStorageService));

/** POST /storage/uploads/course — video, PDF, or Word doc, max 100MB */
router.post("/storage/uploads/course", requireAuth, (req, res) =>
  handleTypedUpload("course", req, res, objectStorageService));

/** GET /storage/uploads/limit — check today's remaining uploads */
router.get("/storage/uploads/limit", requireAuth, async (req, res) => {
  const user = (req as any).dbUser;
  const { remaining } = await checkLimit(user.id);
  res.json({ remaining, dailyLimit: DAILY_LIMIT, resetsAt: "midnight UTC" });
});

// ─── Legacy generic endpoint (kept for backward compatibility) ────────────────
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const parsed = UploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const { name, size, contentType } = parsed.data;
    res.json({ uploadURL, objectPath, metadata: { name, size, contentType } });
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// ─── Backward-compatible alias: /api/objects/* → same as /api/storage/objects/* ──
// Needed for any URLs already saved in the DB before the /storage prefix was added.

router.get("/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object (alias)");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

// ─── Serve public objects ─────────────────────────────────────────────────────

router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) { res.status(404).json({ error: "File not found" }); return; }
    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

// ─── Serve private objects ────────────────────────────────────────────────────

router.get("/storage/objects/*path", async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
