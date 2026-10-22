import type { NextFunction, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.js";

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

async function readSession(req: Request): Promise<Session | null> {
  const token = req.cookies?.[COOKIE];
  if (!token || config.authSecret.length < 16) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { userId: payload.userId as string, email: payload.email as string, role: payload.role as Session["role"] };
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
