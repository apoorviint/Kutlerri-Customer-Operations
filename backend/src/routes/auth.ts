import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "../db.js";
import { clearSession, issueSession, requireUser } from "../auth.js";

export const authRouter = Router();

// Valid bcrypt hash compared against when the email is unknown, so timing doesn't reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

// Simple in-memory throttle: 10 failed attempts per IP per 15 minutes.
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 10;
const fails = new Map<string, { count: number; resetAt: number }>();

const Body = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

authRouter.post("/login", async (req, res) => {
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
  if (!user || !ok) {
    const cur = f && f.resetAt > Date.now() ? f : { count: 0, resetAt: Date.now() + WINDOW_MS };
    cur.count++;
    fails.set(ip, cur);
    return void res.status(401).json({ error: "Invalid email or password" });
  }

  fails.delete(ip);
  await issueSession(res, { userId: user.id, email: user.email, role: user.role });
  res.json({ email: user.email, role: user.role });
});

authRouter.post("/logout", (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get("/me", requireUser, (req, res) => {
  res.json({ email: req.session!.email, role: req.session!.role });
});
