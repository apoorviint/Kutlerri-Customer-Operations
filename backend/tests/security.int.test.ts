/**
 * Phase 5: Google sign-in rules, roles and user management, upload content checks, headers, limits and health checks.
 * The database parts need TEST_DATABASE_URL; the rest run anywhere.
 */
import { execSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const HAS_DB = !!process.env.TEST_DATABASE_URL;
process.env.GOOGLE_CLIENT_ID = "client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret";
process.env.ALLOWED_EMAIL_DOMAIN = "kutlerri.ai";
process.env.ADMIN_EMAILS = "boss@kutlerri.ai";
process.env.PUBLIC_URL = "https://ops.example.com";
process.env.UPLOAD_DIR = mkdtempSync(join(tmpdir(), "ops-sec-"));

describe("who may sign in with Google", async () => {
  const { authorize } = await import("../src/services/google.js");
  const o = { domain: "kutlerri.ai", nonce: "n1" };
  const good = { email: "Jane@Kutlerri.ai", email_verified: true, hd: "kutlerri.ai", nonce: "n1" };
  it("a verified company account is accepted, and the email is normalised", () => {
    expect(authorize(good, o)).toEqual({ ok: true, email: "jane@kutlerri.ai" });
  });
  it("a personal Gmail account is refused", () => {
    expect(authorize({ ...good, email: "jane@gmail.com", hd: undefined }, o)).toMatchObject({ ok: false });
  });
  it("a look-alike domain is refused, even if Google says the email is verified", () => {
    expect(authorize({ ...good, email: "jane@kutlerri.ai.evil.com", hd: "evil.com" }, o).ok).toBe(false);
    expect(authorize({ ...good, email: "jane@notkutlerri.ai" }, o).ok).toBe(false);
    expect(authorize({ ...good, hd: "other.com" }, o).ok).toBe(false); // right email domain, wrong hosted domain
  });
  it("an unverified email or a wrong nonce is refused", () => {
    expect(authorize({ ...good, email_verified: false }, o).ok).toBe(false);
    expect(authorize({ ...good, nonce: "other" }, o).ok).toBe(false);
    expect(authorize({ email_verified: true }, o).ok).toBe(false);
  });
  it("nothing is accepted when no domain is configured", () => {
    expect(authorize(good, { domain: "", nonce: "n1" }).ok).toBe(false);
  });
});

describe("the sign-in redirect", async () => {
  const { newFlow, authUrl } = await import("../src/services/google.js");
  it("carries the state, nonce, PKCE challenge, the company domain and the website's return address", () => {
    const f = newFlow();
    const u = new URL(authUrl(f));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      client_id: "client-id.apps.googleusercontent.com", response_type: "code", state: f.state, nonce: f.nonce, hd: "kutlerri.ai",
      code_challenge: f.challenge, code_challenge_method: "S256", redirect_uri: "https://ops.example.com/api/auth/google/callback",
    });
    expect(newFlow().state).not.toBe(f.state);
  });
});

describe("file content checks", async () => {
  const { looksLike } = await import("../src/security.js");
  it("an xlsx must be a zip, a csv must be text", () => {
    expect(looksLike("xlsx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]))).toBe(true);
    expect(looksLike("xlsx", Buffer.from("MZ executable"))).toBe(false);
    expect(looksLike("csv", Buffer.from("a,b\n1,2\n"))).toBe(true);
    expect(looksLike("csv", Buffer.from([0x50, 0x4b, 0, 4]))).toBe(false);
  });
});

describe("rate limit", async () => {
  const { rateLimit } = await import("../src/security.js");
  it("lets a few through, then answers 429 with Retry-After, and skips exempt requests", () => {
    const lim = rateLimit(2, 60_000, (r) => r.headers?.["x-skip"] === "1");
    const call = (headers: Record<string, string> = {}) => {
      let status = 200; const set: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => (set[k] = v), status: (s: number) => ({ json: () => (status = s) }) };
      let nexted = false;
      lim({ ip: "1.1.1.1", headers } as never, res as never, () => (nexted = true));
      return { status, nexted, set };
    };
    expect(call().nexted).toBe(true);
    expect(call().nexted).toBe(true);
    const third = call();
    expect(third).toMatchObject({ status: 429, nexted: false });
    expect(Number(third.set["Retry-After"])).toBeGreaterThan(0);
    expect(call({ "x-skip": "1" }).nexted).toBe(true);
  });
});

let db: typeof import("../src/db.js").db;
let server: Server;
let base = "";
let adminToken = "", viewerToken = "", ghostToken = "";
let ids: Record<string, string> = {};

async function sign(userId: string, email: string, role: string) {
  const { SignJWT } = await import("jose");
  return new SignJWT({ userId, email, role }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(process.env.AUTH_SECRET!));
}

beforeAll(async () => {
  if (!HAS_DB) return;
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: process.env });
  ({ db } = await import("../src/db.js"));
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const { authRouter } = await import("../src/routes/auth.js");
  const { adminRouter } = await import("../src/routes/admin.js");
  const { uploadsRouter } = await import("../src/routes/uploads.js");
  const { healthRouter } = await import("../src/routes/health.js");
  const { securityHeaders } = await import("../src/security.js");
  const app = express();
  app.use(securityHeaders);
  app.use(express.json());
  app.use(cookieParser());
  app.use("/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin/files", uploadsRouter);
  app.use("/api/admin", adminRouter);
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  if (!HAS_DB) return;
  await new Promise((r) => server.close(r));
  await db.$disconnect();
});
beforeEach(async () => {
  if (!HAS_DB) return;
  const { forgetUsers } = await import("../src/auth.js");
  forgetUsers();
  await db.$executeRaw`TRUNCATE users, sync_runs, audit_log RESTART IDENTITY CASCADE`;
  const a = await db.user.create({ data: { email: "boss@kutlerri.ai", role: "ADMIN" } });
  const v = await db.user.create({ data: { email: "viewer@kutlerri.ai", role: "VIEWER" } });
  ids = { admin: a.id, viewer: v.id };
  adminToken = await sign(a.id, a.email, "ADMIN");
  viewerToken = await sign(v.id, v.email, "VIEWER");
  ghostToken = await sign("does-not-exist", "ghost@kutlerri.ai", "ADMIN");
});

const as = (token: string | null, path: string, init: RequestInit = {}) =>
  fetch(base + path, { ...init, redirect: "manual", headers: { ...(token ? { cookie: `session=${token}` } : {}), "content-type": "application/json", ...(init.headers ?? {}) } });

describe.skipIf(!HAS_DB)("sign-in options and the Google round trip", () => {
  it("the sign-in page learns what is offered", async () => {
    expect(await (await as(null, "/api/auth/config")).json()).toEqual({ google: true, password: true, domain: "kutlerri.ai" });
  });
  it("starting Google sign-in redirects to Google and sets a short-lived signed cookie", async () => {
    const r = await as(null, "/api/auth/google");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toMatch(/^https:\/\/accounts\.google\.com\//);
    expect(r.headers.get("set-cookie")).toMatch(/oauth_flow=.*HttpOnly/i);
  });
  it("a callback without the cookie, or with the wrong state, goes back to the sign-in page with a reason", async () => {
    const r = await as(null, "/api/auth/google/callback?code=x&state=y");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toMatch(/^\/login\?error=/);
    const start = await as(null, "/api/auth/google");
    const cookie = start.headers.get("set-cookie")!.split(";")[0];
    const bad = await fetch(base + "/api/auth/google/callback?code=x&state=wrong", { redirect: "manual", headers: { cookie } });
    expect(decodeURIComponent(bad.headers.get("location")!)).toMatch(/could not be verified/);
  });
  it("password sign-in can be switched off", async () => {
    process.env.ALLOW_PASSWORD_LOGIN = "false";
    try {
      expect(await (await as(null, "/api/auth/config")).json()).toMatchObject({ password: false });
      const r = await as(null, "/api/auth/login", { method: "POST", body: JSON.stringify({ email: "boss@kutlerri.ai", password: "x" }) });
      expect(r.status).toBe(403);
    } finally { delete process.env.ALLOW_PASSWORD_LOGIN; }
  });
  it("a user without a password (Google only) cannot sign in with a password, and an inactive one cannot either", async () => {
    const bcrypt = (await import("bcryptjs")).default;
    await db.user.create({ data: { email: "pw@kutlerri.ai", passwordHash: await bcrypt.hash("secret-pass-1", 4), role: "VIEWER" } });
    const ok = await as(null, "/api/auth/login", { method: "POST", body: JSON.stringify({ email: "pw@kutlerri.ai", password: "secret-pass-1" }) });
    expect(ok.status).toBe(200);
    expect((await as(null, "/api/auth/login", { method: "POST", body: JSON.stringify({ email: "viewer@kutlerri.ai", password: "anything" }) })).status).toBe(401);
    await db.user.update({ where: { email: "pw@kutlerri.ai" }, data: { active: false } });
    expect((await as(null, "/api/auth/login", { method: "POST", body: JSON.stringify({ email: "pw@kutlerri.ai", password: "secret-pass-1" }) })).status).toBe(401);
  });
});

describe.skipIf(!HAS_DB)("roles and user management", () => {
  it("a viewer cannot reach any admin endpoint; an admin can", async () => {
    expect((await as(viewerToken, "/api/admin/users")).status).toBe(403);
    expect((await as(viewerToken, "/api/admin/files/billing/uploads")).status).toBe(403);
    expect((await as(adminToken, "/api/admin/users")).status).toBe(200);
  });
  it("lists users without exposing password hashes", async () => {
    const list = await (await as(adminToken, "/api/admin/users")).json();
    expect(list.map((u: { email: string }) => u.email)).toEqual(["boss@kutlerri.ai", "viewer@kutlerri.ai"]);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|\$2[aby]\$/);
  });
  it("promotes a viewer, and the new role applies at once (the cookie still says viewer)", async () => {
    expect((await as(viewerToken, "/api/admin/users")).status).toBe(403);
    expect((await as(adminToken, `/api/admin/users/${ids.viewer}`, { method: "PUT", body: JSON.stringify({ role: "ADMIN" }) })).status).toBe(200);
    expect((await as(viewerToken, "/api/admin/users")).status).toBe(200);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "user.update" } })).target).toBe("viewer@kutlerri.ai");
  });
  it("switching someone off signs them out of everything", async () => {
    expect((await as(viewerToken, "/api/auth/config")).status).toBe(200);
    await as(adminToken, `/api/admin/users/${ids.viewer}`, { method: "PUT", body: JSON.stringify({ active: false }) });
    const { default: express } = await import("express");
    void express;
    const me = await as(viewerToken, "/api/admin/users");
    expect(me.status).toBe(401);
  });
  it("you cannot lock yourself out, and the last administrator cannot be removed", async () => {
    expect((await as(adminToken, `/api/admin/users/${ids.admin}`, { method: "PUT", body: JSON.stringify({ role: "VIEWER" }) })).status).toBe(400);
    expect((await as(adminToken, `/api/admin/users/${ids.admin}`, { method: "PUT", body: JSON.stringify({ active: false }) })).status).toBe(400);
    const second = await db.user.create({ data: { email: "two@kutlerri.ai", role: "ADMIN" } });
    const t2 = await sign(second.id, second.email, "ADMIN");
    // two admins: one may demote the other
    expect((await as(t2, `/api/admin/users/${ids.admin}`, { method: "PUT", body: JSON.stringify({ role: "VIEWER" }) })).status).toBe(200);
    // now only one admin is left; it cannot demote itself (and nobody else is an admin to do it)
    expect((await as(t2, `/api/admin/users/${second.id}`, { method: "PUT", body: JSON.stringify({ active: false }) })).status).toBe(400);
  });
  it("pre-registers a company address with a role, and refuses other domains and duplicates", async () => {
    expect((await as(adminToken, "/api/admin/users", { method: "POST", body: JSON.stringify({ email: "new@kutlerri.ai", role: "VIEWER" }) })).status).toBe(201);
    expect((await as(adminToken, "/api/admin/users", { method: "POST", body: JSON.stringify({ email: "new@kutlerri.ai", role: "VIEWER" }) })).status).toBe(400);
    expect((await as(adminToken, "/api/admin/users", { method: "POST", body: JSON.stringify({ email: "x@gmail.com", role: "VIEWER" }) })).status).toBe(400);
  });
  it("outside development, a cookie for a user who is not in the database is refused", async () => {
    // (in tests such cookies are accepted so other suites can sign their own; the production rule is exercised here directly)
    const { config } = await import("../src/config.js");
    const prev = config.isProd;
    (config as { isProd: boolean }).isProd = true;
    try {
      const { forgetUsers } = await import("../src/auth.js");
      forgetUsers();
      expect((await as(ghostToken, "/api/admin/users")).status).toBe(401);
    } finally { (config as { isProd: boolean }).isProd = prev; }
  });
});

describe.skipIf(!HAS_DB)("headers, uploads and health", () => {
  it("every response carries the protective headers and is not cached", async () => {
    const r = await as(null, "/api/auth/config");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toMatch(/default-src 'none'/);
  });
  it("a file renamed to .xlsx but not a workbook is refused; a binary renamed to .csv too", async () => {
    const send = async (name: string, bytes: Buffer) => {
      const f = new FormData();
      f.set("file", new Blob([bytes]), name);
      return fetch(base + "/api/admin/files/billing/preview", { method: "POST", body: f, headers: { cookie: `session=${adminToken}` } });
    };
    const a = await send("orders.xlsx", Buffer.from("this is plain text"));
    expect(a.status).toBe(400);
    expect((await a.json()).error).toMatch(/not really a \.xlsx/);
    expect((await send("orders.csv", Buffer.from([0x4d, 0x5a, 0, 0, 1]))).status).toBe(400);
  });
  it("health answers without signing in; /ready checks the database; /feeds is 503 until a recent successful sync", async () => {
    expect((await fetch(base + "/health")).status).toBe(200);
    expect(await (await fetch(base + "/health/ready")).json()).toEqual({ status: "ready" });
    expect((await fetch(base + "/health/feeds")).status).toBe(503);
    await db.syncRun.create({ data: { source: "calls", kind: "incremental", status: "ok", finishedAt: new Date() } });
    expect((await fetch(base + "/health/feeds")).status).toBe(200);
    await db.syncRun.create({ data: { source: "calls", kind: "incremental", status: "failed", finishedAt: new Date() } });
    expect(await (await fetch(base + "/health/feeds")).json()).toEqual({ status: "stale" });
  });
});
