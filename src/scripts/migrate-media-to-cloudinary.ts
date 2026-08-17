/**
 * One-time migration: move legacy/seed media (Google CDN sample videos,
 * picsum.photos covers, dicebear avatars) into Cloudinary so playback and
 * loading are backed by a reliable CDN instead of third-party demo hosts.
 *
 * Safe to re-run — any URL that is already on Cloudinary (res.cloudinary.com)
 * is skipped.
 *
 * Usage: pnpm --filter @workspace/scripts run migrate-media
 */
import { db } from "./db";
import {
  postsTable,
  creatorsTable,
  usersTable,
  coursesTable,
  lessonsTable,
  storiesTable,
} from "./db";
import { eq, isNotNull } from "drizzle-orm";
import { v2 as cloudinary } from "cloudinary";

function ensureConfigured(): void {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.",
    );
  }
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true,
  });
}

type ResourceType = "image" | "video";

async function migrateUrl(url: string, folder: string, resourceType: ResourceType): Promise<string | null> {
  try {
    const result = await cloudinary.uploader.upload(url, { folder, resource_type: resourceType });
    return result.secure_url;
  } catch (err) {
    console.error(`  ✗ Failed to migrate ${url}:`, (err as Error).message);
    return null;
  }
}

function isAlreadyMigrated(url: string | null): boolean {
  return !!url && url.includes("res.cloudinary.com");
}

// Many seed rows point at the same handful of stock video/image URLs — cache
// by source URL so we upload each distinct asset to Cloudinary only once.
const uploadCache = new Map<string, string>();

async function migrateUrlCached(url: string, folder: string, resourceType: ResourceType): Promise<string | null> {
  const cached = uploadCache.get(url);
  if (cached) return cached;
  const result = await migrateUrl(url, folder, resourceType);
  if (result) uploadCache.set(url, result);
  return result;
}

async function migratePosts() {
  const posts = await db.query.postsTable.findMany({
    where: isNotNull(postsTable.mediaUrl),
  });
  console.log(`Posts: found ${posts.length} with media`);
  let migrated = 0;
  for (const post of posts) {
    if (!post.mediaUrl || isAlreadyMigrated(post.mediaUrl)) continue;
    const resourceType: ResourceType = post.mediaType === "video" ? "video" : "image";
    const newUrl = await migrateUrlCached(post.mediaUrl, "creatorhub/posts-migrated", resourceType);
    if (newUrl) {
      await db.update(postsTable).set({ mediaUrl: newUrl }).where(eq(postsTable.id, post.id));
      migrated++;
      console.log(`  ✓ post ${post.id} → ${newUrl}`);
    }
  }
  console.log(`Posts migrated: ${migrated}/${posts.length}`);
}

async function migrateCreators() {
  const creators = await db.query.creatorsTable.findMany();
  console.log(`Creators: found ${creators.length}`);
  let migrated = 0;
  for (const creator of creators) {
    const updates: Record<string, string> = {};
    if (creator.avatarUrl && !isAlreadyMigrated(creator.avatarUrl)) {
      const url = await migrateUrlCached(creator.avatarUrl, "creatorhub/avatars-migrated", "image");
      if (url) updates.avatarUrl = url;
    }
    if (creator.coverUrl && !isAlreadyMigrated(creator.coverUrl)) {
      const url = await migrateUrlCached(creator.coverUrl, "creatorhub/covers-migrated", "image");
      if (url) updates.coverUrl = url;
    }
    if (Object.keys(updates).length > 0) {
      await db.update(creatorsTable).set(updates).where(eq(creatorsTable.id, creator.id));
      migrated++;
      console.log(`  ✓ creator ${creator.id}`);
    }
  }
  console.log(`Creators migrated: ${migrated}/${creators.length}`);
}

async function migrateUsers() {
  const users = await db.query.usersTable.findMany({ where: isNotNull(usersTable.avatarUrl) });
  console.log(`Users: found ${users.length} with avatars`);
  let migrated = 0;
  for (const user of users) {
    if (!user.avatarUrl || isAlreadyMigrated(user.avatarUrl)) continue;
    const url = await migrateUrlCached(user.avatarUrl, "creatorhub/avatars-migrated", "image");
    if (url) {
      await db.update(usersTable).set({ avatarUrl: url }).where(eq(usersTable.id, user.id));
      migrated++;
      console.log(`  ✓ user ${user.id}`);
    }
  }
  console.log(`Users migrated: ${migrated}/${users.length}`);
}

async function migrateCourses() {
  const courses = await db.query.coursesTable.findMany({ where: isNotNull(coursesTable.thumbnailUrl) });
  console.log(`Courses: found ${courses.length} with thumbnails`);
  let migrated = 0;
  for (const course of courses) {
    if (!course.thumbnailUrl || isAlreadyMigrated(course.thumbnailUrl)) continue;
    const url = await migrateUrlCached(course.thumbnailUrl, "creatorhub/course-thumbnails-migrated", "image");
    if (url) {
      await db.update(coursesTable).set({ thumbnailUrl: url }).where(eq(coursesTable.id, course.id));
      migrated++;
      console.log(`  ✓ course ${course.id}`);
    }
  }
  console.log(`Courses migrated: ${migrated}/${courses.length}`);
}

async function migrateLessons() {
  const lessons = await db.query.lessonsTable.findMany({ where: isNotNull(lessonsTable.contentUrl) });
  console.log(`Lessons: found ${lessons.length} with content`);
  let migrated = 0;
  for (const lesson of lessons) {
    if (!lesson.contentUrl || isAlreadyMigrated(lesson.contentUrl)) continue;
    // PDFs / docs go through as "raw" — Cloudinary auto-detects for raw, but we
    // only proactively migrate video content types here since that's the
    // playback-reliability issue; pdf/doc lessons are left untouched.
    if (lesson.contentType !== "video") continue;
    const url = await migrateUrlCached(lesson.contentUrl, "creatorhub/lesson-content-migrated", "video");
    if (url) {
      await db.update(lessonsTable).set({ contentUrl: url }).where(eq(lessonsTable.id, lesson.id));
      migrated++;
      console.log(`  ✓ lesson ${lesson.id}`);
    }
  }
  console.log(`Lessons migrated: ${migrated}/${lessons.length}`);
}

async function migrateStories() {
  const stories = await db.query.storiesTable.findMany();
  console.log(`Stories: found ${stories.length}`);
  let migrated = 0;
  for (const story of stories) {
    if (isAlreadyMigrated(story.mediaUrl)) continue;
    const resourceType: ResourceType = story.mediaType === "video" ? "video" : "image";
    const url = await migrateUrlCached(story.mediaUrl, "creatorhub/stories-migrated", resourceType);
    if (url) {
      await db.update(storiesTable).set({ mediaUrl: url }).where(eq(storiesTable.id, story.id));
      migrated++;
      console.log(`  ✓ story ${story.id}`);
    }
  }
  console.log(`Stories migrated: ${migrated}/${stories.length}`);
}

async function main() {
  ensureConfigured();
  console.log("Starting media migration to Cloudinary...\n");
  await migratePosts();
  await migrateCreators();
  await migrateUsers();
  await migrateCourses();
  await migrateLessons();
  await migrateStories();
  console.log("\nMigration complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
