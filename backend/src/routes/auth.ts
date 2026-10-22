import { Router, type Response } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { clearSession, issueSession, requireUser, signShort, verifyShort } from "../auth.js";
import { config, googleEnabled, passwordLoginEnabled } from "../config.js";
import { audit } from "../services/audit.js";
import { authorize, authUrl, exchange, newFlow } from "../services/google.js";

export const authRouter = Router();

// Valid bcrypt hash compared against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

// Simple in-memory throttle: 10 failed attempts per IP per 15 minutes.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, { count: number; resetAt: number }>();

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

/** What the sign-in page should offer. */
authRouter.get("/config", (_req, res) => {
  res.json({ google: googleEnabled(), password: passwordLoginEnabled(), domain: googleEnabled() ? config.allowedDomain : null });
});

authRouter.post("/login", async (req, res) => {
  if (!passwordLoginEnabled()) return void res.status(403).json({ error: "Sign in with Google." });
  const ip = req.ip ?? "unknown";
  const f = fails.get(ip);
  if (f && f.resetAt > Date.now() && f.count >= MAX_FAILS) {
    return void res.status(429).json({ error: "Too many attempts. Try again later." });
  }

  const parsed = Body.safeParse(req.body);
  if (!parsed.success) return void res.status(400).json({ error: "Email and password are required" });
  const email = parsed.data.email.trim().toLowerCase();

  const user = await db.user.findUnique({ where: { email } });
  const ok = await bcrypt.compare(parsed.data.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !user.active || !ok) {
    const cur = f && f.resetAt > Date.now() ? f : { count: 0, resetAt: Date.now() + WINDOW_MS };
    cur.count++;
    fails.set(ip, cur);
    return void res.status(401).json({ error: "Invalid email or password" });
  }

  fails.delete(ip);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await issueSession(res, { userId: user.id, email: user.email, role: user.role });
  res.json({ email: user.email, role: user.role });
});

// ───────────── Google ─────────────

const FLOW_COOKIE = "oauth_flow";
const back = (res: Response, error?: string) => res.redirect(error ? `/login?error=${encodeURIComponent(error)}` : "/dashboard");

authRouter.get("/google", async (_req, res) => {
  if (!googleEnabled()) return void back(res, "Google sign-in is not set up.");
  const flow = newFlow();
  res.cookie(FLOW_COOKIE, await signShort({ s: flow.state, n: flow.nonce, v: flow.verifier }, 600), {
    httpOnly: true, sameSite: "lax", secure: config.isProd, path: "/api/auth/google", maxAge: 600_000,
  });
  res.redirect(authUrl(flow));
});

authRouter.get("/google/callback", async (req, res) => {
  const saved = await verifyShort(req.cookies?.[FLOW_COOKIE]);
  res.clearCookie(FLOW_COOKIE, { path: "/api/auth/google" });
  if (!googleEnabled() || !saved) return void back(res, "The sign-in expired. Try again.");
  if (typeof req.query.error === "string") return void back(res, "Google sign-in was cancelled.");
  if (typeof req.query.code !== "string" || req.query.state !== saved.s) return void back(res, "The sign-in could not be verified. Try again.");

  try {
    const claims = await exchange(req.query.code, saved.v as string);
    const who = authorize(claims, { domain: config.allowedDomain, nonce: saved.n as string });
    if (!who.ok) {
      await audit(claims.email ?? "unknown", "auth.denied", null, { reason: who.reason });
      return void back(res, who.reason);
    }
    let user = await db.user.findUnique({ where: { email: who.email } });
    if (user && !user.active) return void back(res, "Your access has been switched off. Ask an administrator.");
    const wantsAdmin = config.adminEmails.includes(who.email);
    if (!user) {
      user = await db.user.create({ data: { email: who.email, role: wantsAdmin ? "ADMIN" : "VIEWER" } });
      await audit(who.email, "user.created", who.email, { role: user.role, via: "google" });
    } else if (wantsAdmin && user.role !== "ADMIN") {
      user = await db.user.update({ where: { id: user.id }, data: { role: "ADMIN" } }); // listed in ADMIN_EMAILS
    }
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await issueSession(res, { userId: user.id, email: user.email, role: user.role });
    back(res);
  } catch (e) {
    console.error("[google sign-in]", e instanceof Error ? e.message : e);
    back(res, "Google sign-in failed. Try again.");
  }
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireUser, (req, res) => {
  res.json({ email: req.session!.email, role: req.session!.role });
});
