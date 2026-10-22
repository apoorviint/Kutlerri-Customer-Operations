import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.js";

/** Headers every response carries. The API returns data only, so nothing on it may be framed, sniffed or embedded. */
export function securityHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Cache-Control", "no-store"); // private data must not sit in a shared cache
  if (config.isProd) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
}

/** A fixed-window limit per client address. In memory, so it is per instance: a brake against runaway scripts, not a firewall. */
export function rateLimit(max: number, windowMs: number, skip: (req: Request) => boolean = () => false) {
  const hits = new Map<string, { n: number; reset: number }>();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (req: Request, res: Response, next: NextFunction) => {
    if (skip(req)) return next();
    const key = req.ip ?? "unknown";
    const now = Date.now();
    const h = hits.get(key);
    if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return next(); }
    if (++h.n > max) {
      res.setHeader("Retry-After", String(Math.ceil((h.reset - now) / 1000)));
      return void res.status(429).json({ error: "Too many requests. Slow down and try again shortly." });
    }
    next();
  };
}

/** One JSON line per request (Cloud Logging reads these): id, method, path without the query, status, milliseconds, who. */
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const id = randomUUID().slice(0, 8);
  const t = Date.now();
  res.setHeader("X-Request-Id", id);
  res.on("finish", () => {
    if (req.path === "/health" || req.path.startsWith("/health/")) return;
    const line = { severity: res.statusCode >= 500 ? "ERROR" : res.statusCode >= 400 ? "WARNING" : "INFO", id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - t, user: req.session?.email };
    if (config.isProd || res.statusCode >= 500) console.log(JSON.stringify(line));
  });
  next();
}

/** Is this really a spreadsheet? An .xlsx is a zip (starts "PK"), a .csv is text (no NUL bytes). Names can lie; contents cannot. */
export function looksLike(kind: "xlsx" | "csv", head: Buffer): boolean {
  if (kind === "xlsx") return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  return !head.includes(0);
}
