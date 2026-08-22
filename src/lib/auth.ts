import { Request, Response, NextFunction } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { db, usersTable, creatorsTable } from "../db";
import { eq } from "drizzle-orm";
import crypto from "crypto";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "danielmanoj20004@gmail.com";

async function getClerkEmail(userId: string): Promise<string> {
  try {
    const clerkUser = await clerkClient.users.getUser(userId);
    const primary = clerkUser.emailAddresses.find(
      (e) => e.id === clerkUser.primaryEmailAddressId,
    );
    return primary?.emailAddress ?? `${userId}@placeholder.com`;
  } catch {
    return `${userId}@placeholder.com`;
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, auth.userId),
  });

  const email = await getClerkEmail(auth.userId);
  const clerkUser = await clerkClient.users.getUser(auth.userId).catch(() => null);

  if (!user) {
    // Check if user already exists in DB by email
    const existingByEmail = await db.query.usersTable.findFirst({
      where: eq(usersTable.email, email),
    });

    if (existingByEmail) {
      // Re-link clerkId to the existing user account
      [user] = await db
        .update(usersTable)
        .set({
          clerkId: auth.userId,
          name: existingByEmail.name ?? (clerkUser ? [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") : null),
          avatarUrl: existingByEmail.avatarUrl ?? clerkUser?.imageUrl ?? null,
        })
        .where(eq(usersTable.id, existingByEmail.id))
        .returning();
    } else {
      // First sign-in: create new user
      const name = clerkUser
        ? [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || null
        : null;
      const avatarUrl = clerkUser?.imageUrl ?? null;
      const role = email === ADMIN_EMAIL ? "admin" : "user";
      const id = crypto.randomUUID();
      const roleSelected = role === "admin" || clerkUser?.unsafeMetadata?.roleSelected === true;
      [user] = await db
        .insert(usersTable)
        .values({ id, clerkId: auth.userId, email, name, avatarUrl, role, roleSelected })
        .onConflictDoUpdate({
          target: usersTable.clerkId,
          set: { email, name: name ?? null, avatarUrl: avatarUrl ?? null },
        })
        .returning();
    }
  } else {
    // Existing user: fix placeholder email if present, then check admin
    const hasPlaceholder = user.email?.includes("@placeholder.com");
    if (hasPlaceholder || (user.email === ADMIN_EMAIL && user.role !== "admin")) {
      const actualEmail = hasPlaceholder ? email : user.email;
      const role =
        actualEmail === ADMIN_EMAIL ? "admin" : user.role === "admin" ? "admin" : user.role;
      [user] = await db
        .update(usersTable)
        .set({ email: actualEmail, role })
        .where(eq(usersTable.clerkId, auth.userId))
        .returning();
    }
  }

  // ─── Automatic Creator Profile Sync ───
  // If the user has a creator profile in creatorsTable, ensure role is "creator"
  if (user && user.role !== "admin") {
    const creator = await db.query.creatorsTable.findFirst({
      where: eq(creatorsTable.userId, user.id),
    });
    if (creator && user.role !== "creator") {
      [user] = await db
        .update(usersTable)
        .set({ role: "creator", roleSelected: true })
        .where(eq(usersTable.id, user.id))
        .returning();
    }
  }

  // Block suspended users
  if (user?.isSuspended) {
    res.status(403).json({ error: "Account suspended", code: "SUSPENDED" });
    return;
  }

  (req as any).dbUser = user;
  next();
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  if (auth.userId) {
    let user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, auth.userId),
    });
    if (user) {
      if (user.role !== "admin") {
        const creator = await db.query.creatorsTable.findFirst({
          where: eq(creatorsTable.userId, user.id),
        });
        if (creator && user.role !== "creator") {
          user.role = "creator";
        }
      }
      (req as any).dbUser = user;
    }
  }
  next();
}

export async function requireCreator(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  let dbUser = (req as any).dbUser;
  if (!dbUser) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (dbUser.role === "creator" || dbUser.role === "admin") {
    next();
    return;
  }

  // Fallback check: look up creatorsTable for this user
  const creator = await db.query.creatorsTable.findFirst({
    where: eq(creatorsTable.userId, dbUser.id),
  });
  if (creator) {
    dbUser.role = "creator";
    dbUser.roleSelected = true;
    await db
      .update(usersTable)
      .set({ role: "creator", roleSelected: true })
      .where(eq(usersTable.id, dbUser.id));
    (req as any).dbUser = dbUser;
    next();
    return;
  }

  res.status(403).json({ error: "Creator access required" });
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const dbUser = (req as any).dbUser;
  if (!dbUser || dbUser.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
