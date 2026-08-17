import fs from "fs-extra";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DEPLOY_DIR = path.join(ROOT, "deploy_repos");
const FRONTEND_DEPLOY = path.join(DEPLOY_DIR, "frontend");
const BACKEND_DEPLOY = path.join(DEPLOY_DIR, "backend");

console.log("Preparing standalone deployment repositories...");
fs.ensureDirSync(DEPLOY_DIR);
fs.ensureDirSync(FRONTEND_DEPLOY);
fs.ensureDirSync(BACKEND_DEPLOY);

// ─── 1. Package Standalone Frontend (for Vercel) ──────────────────────────────

console.log("1. Packaging Frontend for Vercel...");
// Copy frontend source
fs.copySync(path.join(ROOT, "frontend"), FRONTEND_DEPLOY, {
  filter: (src) => !src.includes("node_modules") && !src.includes("dist"),
});

// Copy api-client-react into frontend/src/lib/api-client
const apiClientSrc = path.join(ROOT, "lib/api-client-react/src");
const apiClientDest = path.join(FRONTEND_DEPLOY, "src/lib/api-client");
fs.ensureDirSync(apiClientDest);
fs.copySync(apiClientSrc, apiClientDest);

// Update custom-fetch in apiClient to support VITE_API_URL
const customFetchFile = path.join(apiClientDest, "custom-fetch.ts");
if (fs.existsSync(customFetchFile)) {
  let content = fs.readFileSync(customFetchFile, "utf-8");
  content = content.replace(
    /const BASE = .*?;/g,
    `const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ? import.meta.env.VITE_API_URL.replace(/\\/$/, "") : "";`
  );
  fs.writeFileSync(customFetchFile, content);
}

// Replace all imports of '@workspace/api-client-react' in frontend/src
function replaceInDir(dir: string, fromStr: string, toStr: string) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      replaceInDir(full, fromStr, toStr);
    } else if (f.endsWith(".ts") || f.endsWith(".tsx") || f.endsWith(".mjs")) {
      let c = fs.readFileSync(full, "utf-8");
      if (c.includes(fromStr)) {
        c = c.replaceAll(fromStr, toStr);
        fs.writeFileSync(full, c);
      }
    }
  }
}

replaceInDir(path.join(FRONTEND_DEPLOY, "src"), "@workspace/api-client-react", "@/lib/api-client");

// Write standalone package.json for Frontend
const frontendPkg = {
  name: "dropbeyond-frontend",
  version: "1.0.0",
  private: true,
  type: "module",
  scripts: {
    dev: "vite",
    build: "vite build",
    preview: "vite preview",
  },
  dependencies: {
    "@clerk/react": "^6.4.5",
    "@clerk/themes": "^2.4.57",
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.4",
    "@radix-ui/react-alert-dialog": "^1.1.7",
    "@radix-ui/react-aspect-ratio": "^1.1.3",
    "@radix-ui/react-avatar": "^1.1.4",
    "@radix-ui/react-checkbox": "^1.1.5",
    "@radix-ui/react-collapsible": "^1.1.4",
    "@radix-ui/react-context-menu": "^2.2.7",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-dropdown-menu": "^2.1.7",
    "@radix-ui/react-hover-card": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3",
    "@radix-ui/react-menubar": "^1.1.7",
    "@radix-ui/react-navigation-menu": "^1.2.6",
    "@radix-ui/react-popover": "^1.1.7",
    "@radix-ui/react-progress": "^1.1.3",
    "@radix-ui/react-radio-group": "^1.2.4",
    "@radix-ui/react-scroll-area": "^1.2.4",
    "@radix-ui/react-select": "^2.1.7",
    "@radix-ui/react-separator": "^1.1.3",
    "@radix-ui/react-slider": "^1.2.4",
    "@radix-ui/react-slot": "^1.2.0",
    "@radix-ui/react-switch": "^1.1.4",
    "@radix-ui/react-tabs": "^1.1.4",
    "@radix-ui/react-toast": "^1.2.7",
    "@radix-ui/react-toggle": "^1.1.3",
    "@radix-ui/react-toggle-group": "^1.1.3",
    "@radix-ui/react-tooltip": "^1.2.0",
    "@tailwindcss/typography": "^0.5.15",
    "@tanstack/react-query": "^5.90.21",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "date-fns": "^4.1.0",
    "embla-carousel-react": "^8.6.0",
    "framer-motion": "^12.23.24",
    "input-otp": "^1.4.2",
    "lucide-react": "^0.545.0",
    "next-themes": "^0.4.6",
    "react": "^19.1.0",
    "react-day-picker": "^9.11.1",
    "react-dom": "^19.1.0",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "react-resizable-panels": "^2.1.7",
    "recharts": "^2.15.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "^3.3.1",
    "tailwindcss": "^4.1.14",
    "tailwindcss-animate": "^1.0.7",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "wouter": "^3.3.5",
    "zod": "^3.25.76",
  },
  devDependencies: {
    "@tailwindcss/vite": "^4.1.14",
    "@types/node": "^25.3.3",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^5.0.4",
    "typescript": "~5.9.2",
    "vite": "^7.3.2",
  },
};
fs.writeJsonSync(path.join(FRONTEND_DEPLOY, "package.json"), frontendPkg, { spaces: 2 });

// Write standalone vite.config.ts for Frontend
const viteConfig = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
`;
fs.writeFileSync(path.join(FRONTEND_DEPLOY, "vite.config.ts"), viteConfig);

// Write standalone tsconfig.json for Frontend
const frontendTsconfig = {
  compilerOptions: {
    target: "es2022",
    lib: ["es2022", "dom", "dom.iterable"],
    module: "esnext",
    moduleResolution: "bundler",
    jsx: "preserve",
    resolveJsonModule: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    paths: {
      "@/*": ["./src/*"],
    },
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};
fs.writeJsonSync(path.join(FRONTEND_DEPLOY, "tsconfig.json"), frontendTsconfig, { spaces: 2 });

// Write vercel.json
const vercelJson = {
  rewrites: [{ source: "/(.*)", destination: "/index.html" }],
};
fs.writeJsonSync(path.join(FRONTEND_DEPLOY, "vercel.json"), vercelJson, { spaces: 2 });

// Write .env.example
fs.writeFileSync(
  path.join(FRONTEND_DEPLOY, ".env.example"),
  `# Base URL of your deployed Render backend (e.g. https://dropbeynd-backend.onrender.com)
VITE_API_URL=https://dropbeynd-backend.onrender.com
`
);

// Write .gitignore
fs.writeFileSync(
  path.join(FRONTEND_DEPLOY, ".gitignore"),
  `node_modules/
dist/
.env
.env.local
*.log
`
);

// Write README.md for Frontend
fs.writeFileSync(
  path.join(FRONTEND_DEPLOY, "README.md"),
  `# Drop Beyond — Frontend

Modern creator subscription & digital asset platform built with React, Vite, Tailwind CSS, and TanStack React Query.

## Deployment to Vercel

1. **Import Git Repository**:
   - Go to [Vercel](https://vercel.com) and import \`Danielmanoj/dropbeynd-frontend\`.

2. **Configure Build Settings**:
   - **Framework Preset**: Vite
   - **Build Command**: \`npm run build\`
   - **Output Directory**: \`dist\`

3. **Environment Variables**:
   - Add \`VITE_API_URL\` pointing to your Render backend:
     \`\`\`
     VITE_API_URL=https://dropbeynd-backend.onrender.com
     \`\`\`

4. **Deploy**:
   - Click **Deploy**!

## Local Development

\`\`\`bash
npm install
npm run dev
\`\`\`
`
);

// ─── 2. Package Standalone Backend (for Render) ───────────────────────────────

console.log("2. Packaging Backend for Render...");
// Copy backend source
fs.copySync(path.join(ROOT, "backend"), BACKEND_DEPLOY, {
  filter: (src) => !src.includes("node_modules") && !src.includes("dist"),
});

// Copy db into backend/src/db
const dbSrc = path.join(ROOT, "lib/db/src");
const dbDest = path.join(BACKEND_DEPLOY, "src/db");
fs.ensureDirSync(dbDest);
fs.copySync(dbSrc, dbDest);

// Copy drizzle.config.ts if present
const drizzleConfigSrc = path.join(ROOT, "lib/db/drizzle.config.ts");
if (fs.existsSync(drizzleConfigSrc)) {
  fs.copySync(drizzleConfigSrc, path.join(BACKEND_DEPLOY, "drizzle.config.ts"));
}

// Copy api-zod into backend/src/api-zod
const zodSrc = path.join(ROOT, "lib/api-zod/src");
const zodDest = path.join(BACKEND_DEPLOY, "src/api-zod");
fs.ensureDirSync(zodDest);
fs.copySync(zodSrc, zodDest);

// Copy integrations-openai into backend/src/integrations-openai
const aiSrc = path.join(ROOT, "lib/integrations-openai-ai-server/src");
const aiDest = path.join(BACKEND_DEPLOY, "src/integrations-openai");
fs.ensureDirSync(aiDest);
fs.copySync(aiSrc, aiDest);

// Copy DB sync scripts into backend/src/scripts
const scriptsSrc = path.join(ROOT, "scripts/src");
const scriptsDest = path.join(BACKEND_DEPLOY, "src/scripts");
fs.ensureDirSync(scriptsDest);
fs.copySync(scriptsSrc, scriptsDest);

// Replace workspace imports in backend
replaceInDir(path.join(BACKEND_DEPLOY, "src"), "./db", "./db");
replaceInDir(path.join(BACKEND_DEPLOY, "src"), "./api-zod", "./api-zod");
replaceInDir(path.join(BACKEND_DEPLOY, "src"), "./integrations-openai", "./integrations-openai");

// Fix any relative import depth differences in subfolders
replaceInDir(path.join(BACKEND_DEPLOY, "src/routes"), "./db", "../db");
replaceInDir(path.join(BACKEND_DEPLOY, "src/routes"), "./api-zod", "../api-zod");
replaceInDir(path.join(BACKEND_DEPLOY, "src/routes"), "./integrations-openai", "../integrations-openai");
replaceInDir(path.join(BACKEND_DEPLOY, "src/lib"), "./db", "../db");
replaceInDir(path.join(BACKEND_DEPLOY, "src/lib"), "./api-zod", "../api-zod");
replaceInDir(path.join(BACKEND_DEPLOY, "src/lib"), "./integrations-openai", "../integrations-openai");
replaceInDir(path.join(BACKEND_DEPLOY, "src/db"), "./api-zod", "../api-zod");
replaceInDir(path.join(BACKEND_DEPLOY, "src/scripts"), "./db", "../db");

// Update CORS in backend/src/index.ts to allow FRONTEND_URL
const backendIndex = path.join(BACKEND_DEPLOY, "src/index.ts");
if (fs.existsSync(backendIndex)) {
  let content = fs.readFileSync(backendIndex, "utf-8");
  content = content.replace(
    /app\.use\(cors\(\{[\s\S]*?\}\)\);/g,
    `app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = [
      process.env.FRONTEND_URL,
      "http://localhost:5173",
      "http://localhost:3000",
      "https://dropbeynd-frontend.vercel.app"
    ].filter(Boolean);
    if (allowed.includes(origin) || origin.endsWith(".vercel.app")) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
}));`
  );
  fs.writeFileSync(backendIndex, content);
}

// Standalone backend package.json
const backendPkg = {
  name: "dropbeyond-backend",
  version: "1.0.0",
  private: true,
  type: "module",
  scripts: {
    dev: "node --enable-source-maps ./dist/index.mjs",
    build: "node ./build.mjs",
    start: "node --enable-source-maps ./dist/index.mjs",
    "db:sync": "tsx ./src/scripts/sync-db.ts",
    "db:seed": "tsx ./src/scripts/seed.ts",
  },
  dependencies: {
    "@clerk/express": "^2.1.9",
    "@clerk/shared": "^4.8.5",
    "@google-cloud/storage": "^7.19.0",
    "cloudinary": "^2.10.0",
    "cookie-parser": "^1.4.7",
    "cors": "^2.8.5",
    "dotenv": "^16.4.7",
    "drizzle-orm": "^0.45.2",
    "drizzle-zod": "^0.8.3",
    "express": "^5.0.1",
    "express-rate-limit": "^8.5.2",
    "google-auth-library": "^10.6.2",
    "http-proxy-middleware": "^3.0.5",
    "memorystore": "^1.6.7",
    "multer": "^2.1.1",
    "openai": "^4.85.4",
    "p-limit": "^6.2.0",
    "p-retry": "^6.2.1",
    "pg": "^8.13.3",
    "pino": "^9.6.0",
    "pino-http": "^10.4.0",
    "stripe": "^22.1.0",
    "tsx": "^4.21.0",
    "zod": "^3.25.76",
  },
  devDependencies: {
    "@types/cookie-parser": "^1.4.10",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/multer": "^2.1.0",
    "@types/node": "^25.3.3",
    "@types/pg": "^8.11.11",
    "cross-env": "^10.1.0",
    "drizzle-kit": "^0.30.5",
    "esbuild": "0.25.0",
    "esbuild-plugin-pino": "^2.3.3",
    "pino-pretty": "^13.0.0",
    "thread-stream": "^3.1.0",
    "typescript": "~5.9.2",
  },
};
fs.writeJsonSync(path.join(BACKEND_DEPLOY, "package.json"), backendPkg, { spaces: 2 });

// Write .npmrc for Backend
fs.writeFileSync(path.join(BACKEND_DEPLOY, ".npmrc"), "legacy-peer-deps=true\n");

// Write .npmrc for Frontend
fs.writeFileSync(path.join(FRONTEND_DEPLOY, ".npmrc"), "legacy-peer-deps=true\n");

// Standalone backend tsconfig.json
const backendTsconfig = {
  compilerOptions: {
    target: "es2022",
    lib: ["es2022"],
    module: "esnext",
    moduleResolution: "bundler",
    outDir: "dist",
    rootDir: "src",
    skipLibCheck: true,
    strict: true,
    types: ["node"],
  },
  include: ["src/**/*"],
  exclude: ["node_modules", "dist"],
};
fs.writeJsonSync(path.join(BACKEND_DEPLOY, "tsconfig.json"), backendTsconfig, { spaces: 2 });

// Write render.yaml
const renderYaml = `services:
  - type: web
    name: dropbeyond-backend
    env: node
    plan: free
    buildCommand: npm install --legacy-peer-deps && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: DATABASE_URL
        sync: false
      - key: CLERK_SECRET_KEY
        sync: false
      - key: CLERK_PUBLISHABLE_KEY
        sync: false
      - key: CLOUDINARY_CLOUD_NAME
        sync: false
      - key: CLOUDINARY_API_KEY
        sync: false
      - key: CLOUDINARY_API_SECRET
        sync: false
      - key: FRONTEND_URL
        sync: false
`;
fs.writeFileSync(path.join(BACKEND_DEPLOY, "render.yaml"), renderYaml);

// Write .env.example for Backend
fs.writeFileSync(
  path.join(BACKEND_DEPLOY, ".env.example"),
  `PORT=10000
NODE_ENV=production
DATABASE_URL=postgresql://neondb_owner:...@ep-....neon.tech/neondb?sslmode=require
CLERK_SECRET_KEY=sk_test_...
CLERK_PUBLISHABLE_KEY=pk_test_...
CLOUDINARY_CLOUD_NAME=dccxdsqjn
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
FRONTEND_URL=https://dropbeynd-frontend.vercel.app
`
);

// Write .gitignore for Backend
fs.writeFileSync(
  path.join(BACKEND_DEPLOY, ".gitignore"),
  `node_modules/
dist/
.env
*.log
`
);

// Write README.md for Backend
fs.writeFileSync(
  path.join(BACKEND_DEPLOY, "README.md"),
  `# Drop Beyond — Backend API Server

Express REST API with Drizzle ORM, Postgres (Neon), Cloudinary file storage, Clerk auth, and Stripe payments.

## Deployment to Render

1. **Create a Web Service on Render**:
   - Go to [Render Dashboard](https://dashboard.render.com).
   - Click **New +** -> **Web Service** -> Connect \`Danielmanoj/dropbeynd-backend\`.

2. **Configure Settings**:
   - **Runtime**: Node
   - **Build Command**: \`npm install && npm run build\`
   - **Start Command**: \`npm start\`

3. **Environment Variables**:
   Add the following environment variables in Render's Environment tab:
   - \`DATABASE_URL\` : Your Postgres connection string (from Neon)
   - \`CLOUDINARY_CLOUD_NAME\` : Your Cloudinary cloud name
   - \`CLOUDINARY_API_KEY\` : Your Cloudinary API key
   - \`CLOUDINARY_API_SECRET\` : Your Cloudinary API secret
   - \`FRONTEND_URL\` : Your Vercel frontend URL (e.g. \`https://dropbeynd-frontend.vercel.app\`)
   - \`PORT\` : \`10000\`

4. **Deploy**:
   - Click **Create Web Service**!

## Database Synchronization
To sync database tables on Neon:
\`\`\`bash
npm run db:sync
\`\`\`
`
);

console.log("Standalone repositories successfully created in deploy_repos/!");
