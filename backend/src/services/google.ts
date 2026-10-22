import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "../config.js";

/** Google sign-in (OpenID Connect, authorization code flow with PKCE), restricted to the company's email domain. */

const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const redirectUri = () => `${config.publicUrl}/api/auth/google/callback`;

export function newFlow() {
  const verifier = randomBytes(32).toString("base64url");
  return {
    state: randomBytes(16).toString("base64url"),
    nonce: randomBytes(16).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function authUrl(flow: { state: string; nonce: string; challenge: string }) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: config.google.clientId, redirect_uri: redirectUri(), response_type: "code", scope: "openid email",
    state: flow.state, nonce: flow.nonce, code_challenge: flow.challenge, code_challenge_method: "S256",
    hd: config.allowedDomain, prompt: "select_account",
  }).toString();
  return u.toString();
}

export type Claims = { email?: string; email_verified?: boolean; hd?: string; nonce?: string };

/**
 * Who may come in: a verified Google account on the company domain (both the account's hosted domain and the email's
 * domain must match, so a personal Gmail address, or a look-alike domain, is refused).
 */
export function authorize(c: Claims, o: { domain: string; nonce: string }): { ok: true; email: string } | { ok: false; reason: string } {
  const email = c.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "Google did not share an email address." };
  if (c.nonce !== o.nonce) return { ok: false, reason: "The sign-in could not be verified. Try again." };
  if (c.email_verified !== true) return { ok: false, reason: "Your Google email address is not verified." };
  if (!o.domain || !email.endsWith(`@${o.domain}`) || c.hd?.toLowerCase() !== o.domain) return { ok: false, reason: `Only @${o.domain} accounts can sign in.` };
  return { ok: true, email };
}

/** Trades the one-time code for the signed identity token and checks its signature, issuer, audience and expiry. */
export async function exchange(code: string, verifier: string): Promise<Claims> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: redirectUri(),
      grant_type: "authorization_code", code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google refused the sign-in (${res.status})`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google sent no identity token");
  const { payload } = await jwtVerify(id_token, JWKS, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: config.google.clientId });
  return payload as Claims;
}
