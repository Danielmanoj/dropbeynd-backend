/**
 * Replaces all placeholder / SVG / dicebear / broken media in the DB with
 * curated, production-quality Unsplash photos and confirmed-working videos.
 *
 * Safe to run multiple times — every UPDATE is idempotent.
 *
 * Usage: pnpm --filter @workspace/scripts run populate-media
 */
import { db } from "./db";
import { usersTable, creatorsTable, postsTable, coursesTable, lessonsTable } from "./db";
import { eq } from "drizzle-orm";

// ── Helpers ────────────────────────────────────────────────────────────────

function img(id: string, w = 800, h = 500) {
  return `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80&auto=format`;
}

function avatar(id: string) { return img(id, 400, 400); }
function cover(id: string)  { return img(id, 1200, 400); }
function thumb(id: string)  { return img(id, 800, 450); }
function post(id: string)   { return img(id, 800, 500); }

// ── Confirmed-working video URLs ───────────────────────────────────────────

const VIDEOS = [
  "https://res.cloudinary.com/demo/video/upload/dog.mp4",
  "https://res.cloudinary.com/demo/video/upload/elephants.mp4",
  "https://res.cloudinary.com/demo/video/upload/docs/walking_talking.mp4",
  "https://www.w3schools.com/html/mov_bbb.mp4",
  "https://res.cloudinary.com/demo/video/upload/dog.mp4",
  "https://res.cloudinary.com/demo/video/upload/elephants.mp4",
  "https://res.cloudinary.com/demo/video/upload/docs/walking_talking.mp4",
  "https://www.w3schools.com/html/mov_bbb.mp4",
];

let vidIdx = 0;
function nextVideo() { return VIDEOS[vidIdx++ % VIDEOS.length]; }

// ── Per-creator curated media ──────────────────────────────────────────────
//
// avatarId  — Unsplash photo ID for a realistic portrait
// coverId   — Unsplash photo ID for the full-width banner
// postImgs  — pool of Unsplash IDs for this creator's post images
// thumbId   — Unsplash photo ID for the course card thumbnail

interface CreatorMedia {
  avatarId: string;
  coverId:  string;
  postImgs: string[];
  thumbId:  string;
}

const CREATOR_MEDIA: Record<string, CreatorMedia> = {
  "Alex Thunder": {
    avatarId: "1571019613454-1cb2f99b2d8b",
    coverId:  "1534438327276-14e5300c3a48",
    postImgs: ["1571019614242-c5c5dee9f50b","1583454110551-21f2fa2afe61","1526506118085-60ce8714f8c5","1490645935967-10de6ba17061"],
    thumbId:  "1517836357463-d25dfeac3438",
  },
  "CodeWithPriya": {
    avatarId: "1573496359142-b8d87734a5a2",
    coverId:  "1461749280684-dccba630e2f6",
    postImgs: ["1517077304055-6e89abbf09b0","1555066931-4365d14bab8c","1542903660638-9a6ce7c45bf8","1504639725590-34d0984388bd"],
    thumbId:  "1516321318423-f06f85e504b3",
  },
  "TradingMasterKai": {
    avatarId: "1560250097-0b93528c311a",
    coverId:  "1611974789855-9c2a0a7236a3",
    postImgs: ["1565514020179-026b92b2d70b","1604594849809-dfedbc827105","1611974789855-9c2a0a7236a3","1559526324-4b87b5e36e44"],
    thumbId:  "1611974789855-9c2a0a7236a3",
  },
  "Chef Marco Rossi": {
    avatarId: "1577219491135-ce391730fb2c",
    coverId:  "1556909114-f6e7ad7d3136",
    postImgs: ["1567620905732-2d1ec7ab7445","1498837167922-ddd27525d352","1504674900247-0877df9cc836","1476224203421-9ac39bcb3327"],
    thumbId:  "1466637574441-749b8f19452f",
  },
  "MindfulWithSara": {
    avatarId: "1506794778202-cad84cf45f1d",
    coverId:  "1599901860904-17e6ed7083a0",
    postImgs: ["1545205597-3d9d02c29597","1506126613408-eca07ce68773","1571902943202-507ec2618e8f","1588286840104-8957b019727f"],
    thumbId:  "1506126613408-eca07ce68773",
  },
  "PixelArtByJames": {
    avatarId: "1507003211169-0a1dd7228f2d",
    coverId:  "1513364776144-60967b0f800f",
    postImgs: ["1579783902614-a3fb3927b6a5","1541961017774-22349e4a1262","1513364776144-60967b0f800f","1558618666-fcd25c85cd64"],
    thumbId:  "1464639351491-a172c2aa2911",
  },
  "BeatsByNova": {
    avatarId: "1493225457124-a3eb161ffa5f",
    coverId:  "1514320291840-2e0a9bf2a9ae",
    postImgs: ["1511671782779-c97d3d27a1d4","1598488035139-bdbb2231ce04","1470225620780-dba8ba36b745","1508700115892-45ecd05ae2ad"],
    thumbId:  "1598488035139-bdbb2231ce04",
  },
  "WanderlustWithAmi": {
    avatarId: "1488161628813-04466f872be2",
    coverId:  "1488646953014-85cb44e25828",
    postImgs: ["1476514525535-07fb3b4ae5f1","1506929562872-bb421503ef21","1530789253388-582c481c54b0","1501854140801-50d01698950b"],
    thumbId:  "1530789253388-582c481c54b0",
  },
  "ProGamerZhang": {
    avatarId: "1568602471122-7832951cc4c5",
    coverId:  "1542751371-adc38448a05e",
    postImgs: ["1493711662062-fa541adb3fc8","1550745165-9bc0b252726f","1523474253046-8cd2748b5fd2","1542751371-adc38448a05e"],
    thumbId:  "1509198397153-7e7c4a5ece28",
  },
  "StartupWithRaj": {
    avatarId: "1519085360753-af0119f7cbe7",
    coverId:  "1553484771-371a605b060b",
    postImgs: ["1507679799987-c73779587ccf","1521791136064-7986c2920216","1573164713712-03d14a1c4a6d","1497366216548-37526070297c"],
    thumbId:  "1521791136064-7986c2920216",
  },
  "Dr. Lynn Park": {
    avatarId: "1594824476967-48c8b964273f",
    coverId:  "1499750310107-5fef28a66643",
    postImgs: ["1506784983877-45594efa4cbe","1499750310107-5fef28a66643","1507537297145-19ca0c3a5b85","1493836512294-502baa1986e2"],
    thumbId:  "1506784983877-45594efa4cbe",
  },
  "LensOfLucia": {
    avatarId: "1507814925938-d3e228e6adb9",
    coverId:  "1516035069371-29a1b244cc32",
    postImgs: ["1516035069371-29a1b244cc32","1502982720700-bfff97f2ecac","1495121605193-b116b5b9c5fe","1452570053594-1b985d6ea890"],
    thumbId:  "1495121605193-b116b5b9c5fe",
  },
  "WordsByOliver": {
    avatarId: "1542178243-bc20204b769f",
    coverId:  "1455390582262-044cdead277a",
    postImgs: ["1455390582262-044cdead277a","1481627834876-b7833e8f5570","1512820790803-83ca734da794","1434030216411-0b793f4b4173"],
    thumbId:  "1481627834876-b7833e8f5570",
  },
  "LearnSpanishFast": {
    avatarId: "1531746020798-e6953c6e8e04",
    coverId:  "1546410531-bb4caa6b424d",
    postImgs: ["1546410531-bb4caa6b424d","1456513080510-7bf3a84b82f8","1434030216411-0b793f4b4173","1503676260728-1c00da094a0b"],
    thumbId:  "1503676260728-1c00da094a0b",
  },
  "MathWithMax": {
    avatarId: "1507003211169-0a1dd7228f2d",
    coverId:  "1532012197267-da84d127e765",
    postImgs: ["1532012197267-da84d127e765","1509062522246-fe9f81a6b886","1503676260728-1c00da094a0b","1434030216411-0b793f4b4173"],
    thumbId:  "1509062522246-fe9f81a6b886",
  },
  "CryptoWithVince": {
    avatarId: "1539571696357-5a69c17a67c6",
    coverId:  "1518546305927-5a555bb7020d",
    postImgs: ["1518546305927-5a555bb7020d","1611974789855-9c2a0a7236a3","1559526324-4b87b5e36e44","1565514020179-026b92b2d70b"],
    thumbId:  "1518546305927-5a555bb7020d",
  },
  "FitMomKelly": {
    avatarId: "1597452485669-2c7bb5fef90d",
    coverId:  "1517836357463-d25dfeac3438",
    postImgs: ["1571019614242-c5c5dee9f50b","1490645935967-10de6ba17061","1574680096145-d05b474e2155","1583454110551-21f2fa2afe61"],
    thumbId:  "1574680096145-d05b474e2155",
  },
  "BuildWithBen": {
    avatarId: "1565464027194-7957a2295fb7",
    coverId:  "1504639725590-34d0984388bd",
    postImgs: ["1504639725590-34d0984388bd","1517077304055-6e89abbf09b0","1555066931-4365d14bab8c","1542903660638-9a6ce7c45bf8"],
    thumbId:  "1542903660638-9a6ce7c45bf8",
  },
  "ZenChefTomo": {
    avatarId: "1548142813-c4e997e68b65",
    coverId:  "1540189549336-e6e99eb4b951",
    postImgs: ["1540189549336-e6e99eb4b951","1476224203421-9ac39bcb3327","1455619452474-d2be8b1e70cd","1559847844-5315695dadae"],
    thumbId:  "1559847844-5315695dadae",
  },
  "GrowthHackerEve": {
    avatarId: "1580489944761-15a19d654956",
    coverId:  "1460925895917-afdab827c52f",
    postImgs: ["1460925895917-afdab827c52f","1573164713712-03d14a1c4a6d","1557804506-669a67965ba0","1507679799987-c73779587ccf"],
    thumbId:  "1557804506-669a67965ba0",
  },
  "PeakRunnerDan": {
    avatarId: "1471506480208-91b3a4cc78be",
    coverId:  "1452626038306-9aae5e071dd3",
    postImgs: ["1452626038306-9aae5e071dd3","1476480862126-209bfaa8edc8","1502904550040-7534597429ae","1571019613454-1cb2f99b2d8b"],
    thumbId:  "1476480862126-209bfaa8edc8",
  },
  "AIWithDiana": {
    avatarId: "1573496359142-b8d87734a5a2",
    coverId:  "1620712943543-bcc4688e7485",
    postImgs: ["1620712943543-bcc4688e7485","1555066931-4365d14bab8c","1504639725590-34d0984388bd","1461749280684-dccba630e2f6"],
    thumbId:  "1620712943543-bcc4688e7485",
  },
};

// Fallback for unknown creators
const FALLBACK: CreatorMedia = {
  avatarId: "1535713875002-d1d0cf377fde",
  coverId:  "1497366216548-37526070297c",
  postImgs: ["1507679799987-c73779587ccf","1573164713712-03d14a1c4a6d"],
  thumbId:  "1521791136064-7986c2920216",
};

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log("🖼  Populating real media (Unsplash photos + working videos)…\n");

  const creators = await db.query.creatorsTable.findMany();
  console.log(`Found ${creators.length} creators`);

  for (const creator of creators) {
    const m = CREATOR_MEDIA[creator.name] ?? FALLBACK;

    const newAvatarUrl = avatar(m.avatarId);
    const newCoverUrl  = cover(m.coverId);

    // Update creator record
    await db.update(creatorsTable).set({
      avatarUrl: newAvatarUrl,
      coverUrl:  newCoverUrl,
    }).where(eq(creatorsTable.id, creator.id));

    // Keep users table in sync
    await db.update(usersTable).set({
      avatarUrl: newAvatarUrl,
    }).where(eq(usersTable.id, creator.userId));

    // Update posts for this creator
    const posts = await db.query.postsTable.findMany({ where: eq(postsTable.creatorId, creator.id) });
    let imgIdx = 0;
    for (const p of posts) {
      if (p.mediaType === "video") {
        await db.update(postsTable).set({ mediaUrl: nextVideo() }).where(eq(postsTable.id, p.id));
      } else if (p.mediaType === "image") {
        const imgId = m.postImgs[imgIdx % m.postImgs.length];
        await db.update(postsTable).set({ mediaUrl: post(imgId) }).where(eq(postsTable.id, p.id));
        imgIdx++;
      }
    }

    // Update courses for this creator
    const courses = await db.query.coursesTable.findMany({ where: eq(coursesTable.creatorId, creator.id) });
    for (const c of courses) {
      await db.update(coursesTable).set({ thumbnailUrl: thumb(m.thumbId) }).where(eq(coursesTable.id, c.id));

      // Update lessons with working videos
      const lessons = await db.query.lessonsTable.findMany({ where: eq(lessonsTable.courseId, c.id) });
      for (const l of lessons) {
        if (l.contentType === "video") {
          await db.update(lessonsTable).set({ contentUrl: nextVideo() }).where(eq(lessonsTable.id, l.id));
        }
      }
    }

    console.log(`  ✅ ${creator.name}`);
  }

  console.log("\n✨ All media updated to real photos and working videos!");
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
