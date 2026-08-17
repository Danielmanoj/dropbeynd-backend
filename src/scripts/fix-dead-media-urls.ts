/**
 * The original seed data pointed at two now-unreliable external hosts:
 *  - commondatastorage.googleapis.com/gtv-videos-bucket sample videos → now
 *    return 403 Forbidden for every request (confirmed via curl) — this was
 *    the root cause of broken video playback.
 *  - picsum.photos → intermittently blocked by Cloudflare/Fastly bot
 *    mitigation, returns empty 302/400 responses unpredictably.
 *
 * This one-time fix swaps those dead URLs for confirmed-reachable sources
 * before the Cloudinary ingestion migration runs (Cloudinary's fetch-upload
 * can't ingest a URL that's dead for everyone, us included).
 *
 * Usage: pnpm --filter @workspace/scripts run fix-dead-media
 */
import { db } from "./db";
import { postsTable, creatorsTable, coursesTable, lessonsTable, storiesTable } from "./db";
import { eq } from "drizzle-orm";

const DEAD_VIDEO_URLS = [
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/SubaruOutbackOnStreetAndDirt.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4",
  "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
];

const REPLACEMENT_VIDEOS = [
  "https://res.cloudinary.com/demo/video/upload/dog.mp4",
  "https://res.cloudinary.com/demo/video/upload/elephants.mp4",
  "https://res.cloudinary.com/demo/video/upload/docs/walking_talking.mp4",
  "https://www.w3schools.com/html/mov_bbb.mp4",
];

function replacementVideoFor(deadUrl: string): string {
  const idx = DEAD_VIDEO_URLS.indexOf(deadUrl);
  return REPLACEMENT_VIDEOS[idx % REPLACEMENT_VIDEOS.length];
}

/** Deterministic pastel hex color from a picsum seed string, for a stable-looking placeholder per row. */
function colorFromSeed(seed: string): string {
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  // Fixed saturation/lightness for a pleasant flat color, encoded as hex via HSL->RGB.
  const s = 0.55, l = 0.45;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Self-contained solid-color SVG as a data URI — no external host dependency,
 *  so it can never go dead and never gets rate-limited when uploaded in bulk. */
function replacementImageFor(oldUrl: string, size = "800x500"): string {
  const seedMatch = oldUrl.match(/seed\/([a-zA-Z0-9]+)/);
  const seed = seedMatch ? seedMatch[1] : oldUrl;
  const color = colorFromSeed(seed);
  const [w, h] = size.split("x").map(Number);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#${color}"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

/** True for a dead picsum URL, or any previously-generated placeholder
 *  (placehold.co or an inline SVG data URI) that needs regenerating. */
function needsImageFix(url: string | null | undefined): boolean {
  if (!url) return false;
  if (url.includes("picsum.photos")) return true;
  if (url.includes("placehold.co")) return true;
  return false;
}

async function fixPosts() {
  const posts = await db.query.postsTable.findMany();
  let fixed = 0;
  for (const post of posts) {
    if (!post.mediaUrl) continue;
    let newUrl: string | null = null;
    let newMediaType: "image" | null = null;
    if (DEAD_VIDEO_URLS.includes(post.mediaUrl)) {
      newUrl = replacementVideoFor(post.mediaUrl);
    } else if (needsImageFix(post.mediaUrl)) {
      newUrl = replacementImageFor(post.mediaUrl);
      // Pre-existing seed-data bug: some posts were tagged mediaType="video"
      // while pointing at a picsum.photos *image* URL. The replacement is
      // always an image, so correct mediaType too or Cloudinary/the player
      // will try to treat an image as a video and fail.
      if (post.mediaType !== "image") newMediaType = "image";
    }
    if (newUrl) {
      await db
        .update(postsTable)
        .set({ mediaUrl: newUrl, ...(newMediaType ? { mediaType: newMediaType } : {}) })
        .where(eq(postsTable.id, post.id));
      fixed++;
    }
  }
  console.log(`Posts fixed: ${fixed}/${posts.length}`);
}

async function fixCreators() {
  const creators = await db.query.creatorsTable.findMany();
  let fixed = 0;
  for (const creator of creators) {
    const updates: Record<string, string> = {};
    if (needsImageFix(creator.coverUrl)) updates.coverUrl = replacementImageFor(creator.coverUrl!, "1200x400");
    if (needsImageFix(creator.avatarUrl)) updates.avatarUrl = replacementImageFor(creator.avatarUrl!, "400x400");
    if (Object.keys(updates).length > 0) {
      await db.update(creatorsTable).set(updates).where(eq(creatorsTable.id, creator.id));
      fixed++;
    }
  }
  console.log(`Creators fixed: ${fixed}/${creators.length}`);
}

async function fixCourses() {
  const courses = await db.query.coursesTable.findMany();
  let fixed = 0;
  for (const course of courses) {
    if (!needsImageFix(course.thumbnailUrl)) continue;
    await db.update(coursesTable).set({ thumbnailUrl: replacementImageFor(course.thumbnailUrl!) }).where(eq(coursesTable.id, course.id));
    fixed++;
  }
  console.log(`Courses fixed: ${fixed}/${courses.length}`);
}

async function fixLessons() {
  const lessons = await db.query.lessonsTable.findMany();
  let fixed = 0;
  for (const lesson of lessons) {
    if (lesson.contentUrl && DEAD_VIDEO_URLS.includes(lesson.contentUrl)) {
      await db.update(lessonsTable).set({ contentUrl: replacementVideoFor(lesson.contentUrl) }).where(eq(lessonsTable.id, lesson.id));
      fixed++;
    }
  }
  console.log(`Lessons fixed: ${fixed}/${lessons.length}`);
}

async function fixStories() {
  const stories = await db.query.storiesTable.findMany();
  let fixed = 0;
  for (const story of stories) {
    let newUrl: string | null = null;
    if (DEAD_VIDEO_URLS.includes(story.mediaUrl)) newUrl = replacementVideoFor(story.mediaUrl);
    else if (needsImageFix(story.mediaUrl)) newUrl = replacementImageFor(story.mediaUrl);
    if (newUrl) {
      await db.update(storiesTable).set({ mediaUrl: newUrl }).where(eq(storiesTable.id, story.id));
      fixed++;
    }
  }
  console.log(`Stories fixed: ${fixed}/${stories.length}`);
}

async function main() {
  console.log("Fixing dead media URLs (dead Google sample videos + flaky picsum images)...\n");
  await fixPosts();
  await fixCreators();
  await fixCourses();
  await fixLessons();
  await fixStories();
  console.log("\nDone.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fix failed:", err);
    process.exit(1);
  });
