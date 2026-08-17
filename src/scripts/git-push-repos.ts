import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const FRONTEND_DEPLOY = path.join(ROOT, "deploy_repos/frontend");
const BACKEND_DEPLOY = path.join(ROOT, "deploy_repos/backend");

const FRONTEND_REMOTE = "https://github.com/Danielmanoj/dropbeynd-frontend.git";
const BACKEND_REMOTE = "https://github.com/Danielmanoj/dropbeynd-backend.git";

async function pushRepo(dir: string, remoteUrl: string, name: string) {
  console.log(`\nInitializing and staging ${name}...`);
  await git.init({ fs, dir, defaultBranch: "main" });

  // Stage all files
  const files = await git.listFiles({ fs, dir });
  // Read all files ignoring node_modules, dist, .git
  async function addAll(currentDir: string, relPath = "") {
    const entries = fs.readdirSync(currentDir);
    for (const entry of entries) {
      if (entry === "node_modules" || entry === "dist" || entry === ".git") continue;
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
      message: `Deploy ${name}: Production ready for Vercel/Render`,
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
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

  try {
    const pushResult = await git.push({
      fs,
      http,
      dir,
      remote: "origin",
      ref: "main",
      force: true,
      onAuth: () => {
        const tok = token || "";
        return { username: tok, password: "" };
      },
    });
    console.log(`Successfully pushed ${name}!`, pushResult);
  } catch (err: any) {
    console.error(`Push attempt error for ${name}: ${err?.message}`);
    throw err;
  }
}

async function main() {
  try {
    await pushRepo(FRONTEND_DEPLOY, FRONTEND_REMOTE, "Frontend");
  } catch (e: any) {
    console.log("Frontend push requires GitHub credentials / token.");
  }

  try {
    await pushRepo(BACKEND_DEPLOY, BACKEND_REMOTE, "Backend");
  } catch (e: any) {
    console.log("Backend push requires GitHub credentials / token.");
  }
}

main();
