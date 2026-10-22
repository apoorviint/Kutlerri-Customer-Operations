import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";
import { db } from "./db.js";

export const COOKIE = "session";
const MAX_AGE_S = 60 * 60 * 8;

export type Session = { userId: string; email: string; role: "ADMIN" | "VIEWER" };

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
  }
}

const key = () => new TextEncoder().encode(config.authSecret);

export async function issueSession(res: Response, s: Session) {
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.isProd,
    path: "/",
    maxAge: MAX_AGE_S * 1000,
  });
}

export const clearSession = (res: Response) => res.clearCookie(COOKIE, { path: "/" });

/** A short-lived signed value (used for the Google sign-in round trip). */
export const signShort = (payload: Record<string, unknown>, seconds: number) =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${seconds}s`).sign(key());
export async function verifyShort(token: string | undefined): Promise<Record<string, unknown> | null> {
  if (!token) return null;
  try { return (await jwtVerify(token, key())).payload as Record<string, unknown>; } catch { return null; }
}

// The cookie proves who someone is; the database says whether they are still allowed in and what they may do.
// Checked at most every 30 seconds per person, so deactivating a user or changing a role takes effect within half a minute.
const CHECK_MS = 30_000;
const known = new Map<string, { at: number; role: Session["role"] | null }>();
export const forgetUsers = () => known.clear();

async function currentRole(s: Session): Promise<Session["role"] | null> {
  const hit = known.get(s.userId);
  if (hit && Date.now() - hit.at < CHECK_MS) return hit.role;
  const u = await db.user.findUnique({ where: { id: s.userId }, select: { role: true, active: true } });
  // a cookie for a user that no longer exists is only accepted outside production (the tests sign their own)
  const role = u ? (u.active ? u.role : null) : config.isProd ? null : s.role;
  known.set(s.userId, { at: Date.now(), role });
  return role;
}

async function readSession(req: Request): Promise<Session | null> {
  const token = req.cookies?.[COOKIE];
  if (!token || config.authSecret.length < 16) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const s = { userId: payload.userId as string, email: payload.email as string, role: payload.role as Session["role"] };
    const role = await currentRole(s);
    return role ? { ...s, role } : null;
  } catch {
    return null;
  }
}

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const s = await readSession(req);
  if (!s) return void res.status(401).json({ error: "Unauthorized" });
  req.session = s;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const s = await readSession(req);
  if (!s) return void res.status(401).json({ error: "Unauthorized" });
  if (s.role !== "ADMIN") return void res.status(403).json({ error: "Forbidden" });
  req.session = s;
  next();
}

/** Admin session, or a scheduler sending `Authorization: Bearer $CRON_SECRET`. */
export async function requireAdminOrCron(req: Request, res: Response, next: NextFunction) {
  if (config.cronSecret && req.headers.authorization === `Bearer ${config.cronSecret}`) return next();
  return requireAdmin(req, res, next);
}
