import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "../..");

// Load all potential .env locations
const envLocations = [
  path.join(ROOT, ".env"),
  path.join(ROOT, "deploy_repos/frontend/.env"),
  path.join(ROOT, "deploy_repos/backend/.env"),
  path.join(ROOT, "frontend/.env"),
  path.join(ROOT, "backend/.env"),
  path.join(ROOT, "scripts/.env"),
];

for (const envFile of envLocations) {
  if (fs.existsSync(envFile)) {
    const content = fs.readFileSync(envFile, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx > 0) {
        const k = trimmed.slice(0, eqIdx).trim();
        const v = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[k]) process.env[k] = v;
      }
    }
  }
}

const FRONTEND_DEPLOY = path.join(ROOT, "deploy_repos/frontend");
const BACKEND_DEPLOY = path.join(ROOT, "deploy_repos/backend");

const FRONTEND_REMOTE = "https://github.com/Danielmanoj/dropbeynd-frontend.git";
const BACKEND_REMOTE = "https://github.com/Danielmanoj/dropbeynd-backend.git";

async function pushRepo(dir: string, remoteUrl: string, name: string) {
  console.log(`\nInitializing and staging ${name}...`);
  await git.init({ fs, dir, defaultBranch: "main" });

  // Read all files ignoring node_modules, dist, .git, .env
  async function addAll(currentDir: string, relPath = "") {
    const entries = fs.readdirSync(currentDir);
    for (const entry of entries) {
      if (
        entry === "node_modules" ||
        entry === "dist" ||
        entry === ".git" ||
        entry.startsWith(".env") ||
        entry === ".DS_Store"
      ) {
        continue;
      }
      const full = path.join(currentDir, entry);
      const rel = relPath ? `${relPath}/${entry}` : entry;
      if (fs.statSync(full).isDirectory()) {
        await addAll(full, rel);
      } else {
        await git.add({ fs, dir, filepath: rel });
      }
    }
  }

  await addAll(dir);

  try {
    const sha = await git.commit({
      fs,
      dir,
      author: {
        name: "Daniel Manoj",
        email: "danielmanoj@users.noreply.github.com",
      },
      message: `Deploy ${name}: Fix creator and post image fallback and CORS referrerpolicy handling`,
    });
    console.log(`Committed with sha: ${sha}`);
  } catch (err: any) {
    console.log(`Commit note: ${err?.message}`);
  }

  // Set remote
  const remotes = await git.listRemotes({ fs, dir });
  if (remotes.some((r) => r.remote === "origin")) {
    await git.deleteRemote({ fs, dir, remote: "origin" });
  }
  await git.addRemote({ fs, dir, remote: "origin", url: remoteUrl });

  console.log(`Pushing ${name} to ${remoteUrl}...`);
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.VITE_GITHUB_TOKEN ||
    "";

  if (!token) {
    throw new Error("No GITHUB_TOKEN or GH_TOKEN found in any .env file");
  }

  try {
    const pushResult = await git.push({
      fs,
      http,
      dir,
      remote: "origin",
      ref: "main",
      force: true,
      onAuth: () => {
        return { username: token, password: "" };
      },
    });
    console.log(`✓ Successfully pushed ${name} to GitHub!`, pushResult);
  } catch (err: any) {
    console.error(`✗ Push attempt error for ${name}: ${err?.message}`);
    throw err;
  }
}

async function main() {
  let frontendSuccess = false;
  let backendSuccess = false;

  try {
    await pushRepo(FRONTEND_DEPLOY, FRONTEND_REMOTE, "Frontend");
    frontendSuccess = true;
  } catch (e: any) {
    console.error(`Frontend push failed: ${e.message}`);
  }

  try {
    await pushRepo(BACKEND_DEPLOY, BACKEND_REMOTE, "Backend");
    backendSuccess = true;
  } catch (e: any) {
    console.error(`Backend push failed: ${e.message}`);
  }

  if (frontendSuccess && backendSuccess) {
    console.log("\n==========================================");
    console.log("🚀 ALL CHANGES SUCCESSFULLY PUSHED TO GITHUB!");
    console.log("Vercel and Render deployments will trigger automatically.");
    console.log("==========================================");
  } else {
    console.error("\nOne or more pushes did not succeed. Check credentials and retry.");
  }
}

main();
