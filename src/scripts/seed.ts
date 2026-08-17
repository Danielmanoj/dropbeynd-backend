import { db } from "./db";
import {
  usersTable, creatorsTable, postsTable, coursesTable, lessonsTable,
} from "./db";
import crypto from "crypto";

const NICHES = [
  "Fitness & Health", "Technology & Coding", "Finance & Investing",
  "Education & Tutoring", "Art & Illustration", "Music & Audio",
  "Cooking & Food", "Travel & Lifestyle", "Gaming", "Business & Marketing",
  "Personal Development", "Photography", "Writing & Poetry", "Yoga & Wellness",
  "Language Learning",
];

// Confirmed-working video URLs (Cloudinary demo + W3Schools sample)
const VIDEO_URLS = [
  "https://res.cloudinary.com/demo/video/upload/dog.mp4",
  "https://res.cloudinary.com/demo/video/upload/elephants.mp4",
  "https://res.cloudinary.com/demo/video/upload/docs/walking_talking.mp4",
  "https://www.w3schools.com/html/mov_bbb.mp4",
];

let videoIdx = 0;
function nextVideo() {
  return VIDEO_URLS[videoIdx++ % VIDEO_URLS.length];
}

// Curated Unsplash photo URLs — reliable, no API key needed
function u(id: string, w: number, h: number) {
  return `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80&auto=format`;
}

const CREATORS = [
  {
    name: "Alex Thunder", niche: "Fitness & Health",
    bio: "Transform your body in 90 days with science-backed programs. IFBB Pro & Certified Strength Coach.",
    price: "9.99",
    avatarUrl: u("1571019613454-1cb2f99b2d8b", 400, 400),
    coverUrl:  u("1534438327276-14e5300c3a48", 1200, 400),
    postImages: [u("1571019614242-c5c5dee9f50b", 800, 500), u("1583454110551-21f2fa2afe61", 800, 500)],
    thumbUrl:  u("1517836357463-d25dfeac3438", 800, 450),
  },
  {
    name: "CodeWithPriya", niche: "Technology & Coding",
    bio: "Senior SWE at Google. I teach full-stack dev, system design, and how to crack FAANG interviews.",
    price: "14.99",
    avatarUrl: u("1573496359142-b8d87734a5a2", 400, 400),
    coverUrl:  u("1461749280684-dccba630e2f6", 1200, 400),
    postImages: [u("1517077304055-6e89abbf09b0", 800, 500), u("1555066931-4365d14bab8c", 800, 500)],
    thumbUrl:  u("1516321318423-f06f85e504b3", 800, 450),
  },
  {
    name: "TradingMasterKai", niche: "Finance & Investing",
    bio: "Hedge fund veteran turned educator. Live signals, technical analysis, and risk management frameworks.",
    price: "29.99",
    avatarUrl: u("1560250097-0b93528c311a", 400, 400),
    coverUrl:  u("1611974789855-9c2a0a7236a3", 1200, 400),
    postImages: [u("1565514020179-026b92b2d70b", 800, 500), u("1604594849809-dfedbc827105", 800, 500)],
    thumbUrl:  u("1611974789855-9c2a0a7236a3", 800, 450),
  },
  {
    name: "Chef Marco Rossi", niche: "Cooking & Food",
    bio: "Michelin-starred chef sharing authentic Italian recipes and culinary secrets from my family kitchen.",
    price: "7.99",
    avatarUrl: u("1577219491135-ce391730fb2c", 400, 400),
    coverUrl:  u("1556909114-f6e7ad7d3136", 1200, 400),
    postImages: [u("1567620905732-2d1ec7ab7445", 800, 500), u("1498837167922-ddd27525d352", 800, 500)],
    thumbUrl:  u("1466637574441-749b8f19452f", 800, 450),
  },
  {
    name: "MindfulWithSara", niche: "Yoga & Wellness",
    bio: "500-hr Yoga Alliance certified. Daily flows, breathwork, and meditation to rewire your nervous system.",
    price: "6.99",
    avatarUrl: u("1506794778202-cad84cf45f1d", 400, 400),
    coverUrl:  u("1599901860904-17e6ed7083a0", 1200, 400),
    postImages: [u("1545205597-3d9d02c29597", 800, 500), u("1506126613408-eca07ce68773", 800, 500)],
    thumbUrl:  u("1506126613408-eca07ce68773", 800, 450),
  },
  {
    name: "PixelArtByJames", niche: "Art & Illustration",
    bio: "10+ years in concept art for AAA games. Teaching digital painting, character design and environment art.",
    price: "12.99",
    avatarUrl: u("1507003211169-0a1dd7228f2d", 400, 400),
    coverUrl:  u("1513364776144-60967b0f800f", 1200, 400),
    postImages: [u("1579783902614-a3fb3927b6a5", 800, 500), u("1541961017774-22349e4a1262", 800, 500)],
    thumbUrl:  u("1464639351491-a172c2aa2911", 800, 450),
  },
  {
    name: "BeatsByNova", niche: "Music & Audio",
    bio: "Grammy-nominated producer. Learn beat making, mixing, mastering and music business from scratch.",
    price: "19.99",
    avatarUrl: u("1493225457124-a3eb161ffa5f", 400, 400),
    coverUrl:  u("1514320291840-2e0a9bf2a9ae", 1200, 400),
    postImages: [u("1511671782779-c97d3d27a1d4", 800, 500), u("1598488035139-bdbb2231ce04", 800, 500)],
    thumbUrl:  u("1598488035139-bdbb2231ce04", 800, 450),
  },
  {
    name: "WanderlustWithAmi", niche: "Travel & Lifestyle",
    bio: "Visited 80+ countries on a budget. I share hidden gems, travel hacks and digital nomad strategies.",
    price: "5.99",
    avatarUrl: u("1488161628813-04466f872be2", 400, 400),
    coverUrl:  u("1488646953014-85cb44e25828", 1200, 400),
    postImages: [u("1476514525535-07fb3b4ae5f1", 800, 500), u("1506929562872-bb421503ef21", 800, 500)],
    thumbUrl:  u("1530789253388-582c481c54b0", 800, 450),
  },
  {
    name: "ProGamerZhang", niche: "Gaming",
    bio: "Diamond ranked across 5 titles. Advanced game theory, positioning, and mental game coaching.",
    price: "9.99",
    avatarUrl: u("1568602471122-7832951cc4c5", 400, 400),
    coverUrl:  u("1542751371-adc38448a05e", 1200, 400),
    postImages: [u("1493711662062-fa541adb3fc8", 800, 500), u("1550745165-9bc0b252726f", 800, 500)],
    thumbUrl:  u("1509198397153-7e7c4a5ece28", 800, 450),
  },
  {
    name: "StartupWithRaj", niche: "Business & Marketing",
    bio: "3x founder, $50M+ raised. I teach startup strategy, fundraising, product-market fit and growth hacking.",
    price: "24.99",
    avatarUrl: u("1519085360753-af0119f7cbe7", 400, 400),
    coverUrl:  u("1553484771-371a605b060b", 1200, 400),
    postImages: [u("1507679799987-c73779587ccf", 800, 500), u("1521791136064-7986c2920216", 800, 500)],
    thumbUrl:  u("1521791136064-7986c2920216", 800, 450),
  },
  {
    name: "Dr. Lynn Park", niche: "Personal Development",
    bio: "Harvard-trained psychologist. Evidence-based techniques for confidence, habits, and peak performance.",
    price: "11.99",
    avatarUrl: u("1594824476967-48c8b964273f", 400, 400),
    coverUrl:  u("1499750310107-5fef28a66643", 1200, 400),
    postImages: [u("1506784983877-45594efa4cbe", 800, 500), u("1507537297145-19ca0c3a5b85", 800, 500)],
    thumbUrl:  u("1506784983877-45594efa4cbe", 800, 450),
  },
  {
    name: "LensOfLucia", niche: "Photography",
    bio: "National Geographic contributor. Portrait, street, and landscape photography from theory to print.",
    price: "13.99",
    avatarUrl: u("1507814925938-d3e228e6adb9", 400, 400),
    coverUrl:  u("1516035069371-29a1b244cc32", 1200, 400),
    postImages: [u("1502982720700-bfff97f2ecac", 800, 500), u("1495121605193-b116b5b9c5fe", 800, 500)],
    thumbUrl:  u("1495121605193-b116b5b9c5fe", 800, 450),
  },
  {
    name: "WordsByOliver", niche: "Writing & Poetry",
    bio: "NYT bestselling author. Creative writing workshops, story structure, and getting published in 2024.",
    price: "8.99",
    avatarUrl: u("1542178243-bc20204b769f", 400, 400),
    coverUrl:  u("1455390582262-044cdead277a", 1200, 400),
    postImages: [u("1481627834876-b7833e8f5570", 800, 500), u("1512820790803-83ca734da794", 800, 500)],
    thumbUrl:  u("1481627834876-b7833e8f5570", 800, 450),
  },
  {
    name: "LearnSpanishFast", niche: "Language Learning",
    bio: "Polyglot who speaks 7 languages. Proven immersion method to reach B2 Spanish in 6 months.",
    price: "6.99",
    avatarUrl: u("1531746020798-e6953c6e8e04", 400, 400),
    coverUrl:  u("1546410531-bb4caa6b424d", 1200, 400),
    postImages: [u("1456513080510-7bf3a84b82f8", 800, 500), u("1503676260728-1c00da094a0b", 800, 500)],
    thumbUrl:  u("1503676260728-1c00da094a0b", 800, 450),
  },
  {
    name: "MathWithMax", niche: "Education & Tutoring",
    bio: "MIT PhD student. Making calculus, linear algebra and statistics click for students worldwide.",
    price: "9.99",
    avatarUrl: u("1507003211169-0a1dd7228f2d", 400, 400),
    coverUrl:  u("1532012197267-da84d127e765", 1200, 400),
    postImages: [u("1509062522246-fe9f81a6b886", 800, 500), u("1434030216411-0b793f4b4173", 800, 500)],
    thumbUrl:  u("1509062522246-fe9f81a6b886", 800, 450),
  },
  {
    name: "CryptoWithVince", niche: "Finance & Investing",
    bio: "Early Bitcoin adopter. DeFi protocols, NFT strategy, on-chain analytics and portfolio management.",
    price: "19.99",
    avatarUrl: u("1539571696357-5a69c17a67c6", 400, 400),
    coverUrl:  u("1518546305927-5a555bb7020d", 1200, 400),
    postImages: [u("1559526324-4b87b5e36e44", 800, 500), u("1604594849809-dfedbc827105", 800, 500)],
    thumbUrl:  u("1518546305927-5a555bb7020d", 800, 450),
  },
  {
    name: "FitMomKelly", niche: "Fitness & Health",
    bio: "Postnatal fitness specialist. Helping busy moms reclaim their strength, energy and confidence.",
    price: "7.99",
    avatarUrl: u("1597452485669-2c7bb5fef90d", 400, 400),
    coverUrl:  u("1517836357463-d25dfeac3438", 1200, 400),
    postImages: [u("1574680096145-d05b474e2155", 800, 500), u("1490645935967-10de6ba17061", 800, 500)],
    thumbUrl:  u("1574680096145-d05b474e2155", 800, 450),
  },
  {
    name: "BuildWithBen", niche: "Technology & Coding",
    bio: "Ex-Microsoft engineer. Rust, Go, and systems programming. Low-level to high-performance software.",
    price: "17.99",
    avatarUrl: u("1565464027194-7957a2295fb7", 400, 400),
    coverUrl:  u("1504639725590-34d0984388bd", 1200, 400),
    postImages: [u("1542903660638-9a6ce7c45bf8", 800, 500), u("1504639725590-34d0984388bd", 800, 500)],
    thumbUrl:  u("1542903660638-9a6ce7c45bf8", 800, 450),
  },
  {
    name: "ZenChefTomo", niche: "Cooking & Food",
    bio: "Tokyo-trained sushi master and Japanese home cooking expert. Authentic techniques for Western kitchens.",
    price: "10.99",
    avatarUrl: u("1548142813-c4e997e68b65", 400, 400),
    coverUrl:  u("1540189549336-e6e99eb4b951", 1200, 400),
    postImages: [u("1559847844-5315695dadae", 800, 500), u("1455619452474-d2be8b1e70cd", 800, 500)],
    thumbUrl:  u("1559847844-5315695dadae", 800, 450),
  },
  {
    name: "GrowthHackerEve", niche: "Business & Marketing",
    bio: "VP Marketing at 2 unicorns. SEO, paid ads, viral growth loops and conversion optimization frameworks.",
    price: "22.99",
    avatarUrl: u("1580489944761-15a19d654956", 400, 400),
    coverUrl:  u("1460925895917-afdab827c52f", 1200, 400),
    postImages: [u("1573164713712-03d14a1c4a6d", 800, 500), u("1557804506-669a67965ba0", 800, 500)],
    thumbUrl:  u("1557804506-669a67965ba0", 800, 450),
  },
  {
    name: "PeakRunnerDan", niche: "Fitness & Health",
    bio: "Ultra-marathon coach. Train from couch to 100K with periodization, nutrition, and injury prevention.",
    price: "8.99",
    avatarUrl: u("1471506480208-91b3a4cc78be", 400, 400),
    coverUrl:  u("1452626038306-9aae5e071dd3", 1200, 400),
    postImages: [u("1476480862126-209bfaa8edc8", 800, 500), u("1502904550040-7534597429ae", 800, 500)],
    thumbUrl:  u("1476480862126-209bfaa8edc8", 800, 450),
  },
  {
    name: "AIWithDiana", niche: "Technology & Coding",
    bio: "ML Engineer at OpenAI alum. Practical AI/ML: fine-tuning LLMs, RAG pipelines and AI product building.",
    price: "24.99",
    avatarUrl: u("1573496359142-b8d87734a5a2", 400, 400),
    coverUrl:  u("1620712943543-bcc4688e7485", 1200, 400),
    postImages: [u("1620712943543-bcc4688e7485", 800, 500), u("1555066931-4365d14bab8c", 800, 500)],
    thumbUrl:  u("1620712943543-bcc4688e7485", 800, 450),
  },
];

interface PostTemplate {
  title: string;
  body: string;
  isLocked: boolean;
  mediaType: "none" | "image" | "video";
}

function buildPostTemplates(niche: string, creatorName: string): PostTemplate[] {
  const nicheWord = niche.split("&")[0].trim();
  return [
    {
      title: "Welcome to my channel! 🎉",
      body: `I'm thrilled to have you here. This community is for people who are serious about ${nicheWord.toLowerCase()} and want real, actionable content. Drop a comment introducing yourself — I read every single one!\n\nHere's what you can expect: weekly in-depth content, live Q&As, exclusive resources, and a behind-the-scenes look at my process. Let's grow together! 🚀`,
      isLocked: false,
      mediaType: "image",
    },
    {
      title: `My top 5 tips for ${nicheWord} beginners`,
      body: `After years in ${nicheWord.toLowerCase()}, these are the 5 things I wish someone had told me starting out:\n\n1️⃣ Start with fundamentals — don't skip the basics\n2️⃣ Consistency beats intensity every time\n3️⃣ Track your progress from day one\n4️⃣ Find a community that holds you accountable\n5️⃣ Invest in learning, not just doing\n\nSave this — you'll thank me later. Questions? Drop them below! 👇`,
      isLocked: false,
      mediaType: "video",
    },
    {
      title: "Behind the scenes 🎬",
      body: `Here's a raw, unfiltered look at my workflow and how I prepare content for you every single week. No filters, no polish — just the real process, the mistakes, and everything in between.\n\nCreating quality content takes 3-4x longer than people think. This video shows exactly why — and how I stay consistent even on tough days.`,
      isLocked: false,
      mediaType: "video",
    },
    {
      title: `Advanced ${nicheWord} techniques — members only 🔒`,
      body: `This is the content that took me years to master. I'm breaking down the advanced strategies that top professionals use but rarely share publicly.\n\nInside this premium post:\n• The exact framework I use with my private clients\n• 3 advanced techniques with step-by-step breakdowns\n• Common mistakes even experienced practitioners make\n• My personal toolkit and resources\n\nUnlock this to level up your ${nicheWord.toLowerCase()} game significantly.`,
      isLocked: true,
      mediaType: "video",
    },
  ];
}

async function seed() {
  console.log("🌱 Starting seed…");

  for (const c of CREATORS) {
    const userId = `seed_user_${crypto.randomUUID()}`;
    const creatorId = crypto.randomUUID();

    await db.insert(usersTable).values({
      id: userId,
      clerkId: `seed_clerk_${userId}`,
      email: `${c.name.toLowerCase().replace(/[^a-z0-9]/g, "")}@creatorhub.demo`,
      name: c.name,
      avatarUrl: c.avatarUrl,
      role: "creator",
    }).onConflictDoNothing();

    await db.insert(creatorsTable).values({
      id: creatorId,
      userId,
      name: c.name,
      bio: c.bio,
      niche: c.niche,
      monthlyPrice: c.price,
      subscriberCount: Math.floor(Math.random() * 5000) + 100,
      avatarUrl: c.avatarUrl,
      coverUrl: c.coverUrl,
    }).onConflictDoNothing();

    const templates = buildPostTemplates(c.niche, c.name);
    for (let i = 0; i < templates.length; i++) {
      const tmpl = templates[i];
      let mediaUrl: string | null = null;
      let mediaType = tmpl.mediaType;
      if (mediaType === "video") {
        mediaUrl = nextVideo();
      } else if (mediaType === "image") {
        mediaUrl = c.postImages[i % c.postImages.length];
      }
      await db.insert(postsTable).values({
        id: crypto.randomUUID(),
        creatorId,
        title: tmpl.title,
        body: tmpl.body,
        isLocked: tmpl.isLocked,
        moderationStatus: "active",
        mediaType,
        mediaUrl,
      }).onConflictDoNothing();
    }

    const courseId = crypto.randomUUID();
    await db.insert(coursesTable).values({
      id: courseId,
      creatorId,
      title: `Master ${c.niche} — Complete Course`,
      description: `The most comprehensive ${c.niche} course you'll find anywhere. From beginner fundamentals to advanced mastery.`,
      thumbnailUrl: c.thumbUrl,
      isPublished: true,
    }).onConflictDoNothing();

    const lessonTitles = [
      "Introduction & Course Overview",
      "Core Fundamentals",
      "Intermediate Techniques",
      "Advanced Strategies",
      "Putting It All Together",
    ];
    for (let i = 0; i < lessonTitles.length; i++) {
      await db.insert(lessonsTable).values({
        id: crypto.randomUUID(),
        courseId,
        title: lessonTitles[i],
        description: `In this lesson we dive deep into ${lessonTitles[i].toLowerCase()}.`,
        orderIndex: i + 1,
        contentType: "video",
        contentUrl: VIDEO_URLS[i % VIDEO_URLS.length],
      }).onConflictDoNothing();
    }

    console.log(`  ✅ ${c.name}`);
  }

  console.log(`\n✅ Seeded ${CREATORS.length} creators with posts and courses!`);
}

seed().catch(e => { console.error(e); process.exit(1); });
