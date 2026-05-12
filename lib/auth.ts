// Lightweight Google OAuth + session helpers.
//
// Sessions are stored as an HMAC-signed cookie. Both signing and verification
// use the Web Crypto API so the same helpers work in the Edge runtime
// (middleware) and the Node runtime (route handlers).

export const SESSION_COOKIE = "codexweb_session";
export const OAUTH_STATE_COOKIE = "codexweb_oauth_state";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
  exp: number; // unix seconds
}

export interface OAuthStatePayload {
  state: string;
  redirect: string;
  exp: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) {
    throw new Error(
      "AUTH_SECRET is not set or too short (>= 16 chars required). " +
        "Generate one with: openssl rand -base64 32",
    );
  }
  return s;
}

async function sign<T extends object>(payload: T): Promise<string> {
  const key = await hmacKey(getSecret());
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return body + "." + b64urlEncode(new Uint8Array(sig));
}

async function verify<T>(token: string): Promise<T | null> {
  const idx = token.indexOf(".");
  if (idx < 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  try {
    const key = await hmacKey(getSecret());
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      b64urlDecode(sig),
      enc.encode(body),
    );
    if (!ok) return null;
    const json = new TextDecoder().decode(b64urlDecode(body));
    const obj = JSON.parse(json) as T & { exp?: number };
    if (obj.exp && obj.exp * 1000 < Date.now()) return null;
    return obj;
  } catch {
    return null;
  }
}

export async function createSessionCookie(
  user: Omit<SessionPayload, "exp">,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return sign({ ...user, exp });
}

export async function readSession(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  return verify<SessionPayload>(token);
}

export async function createOAuthStateCookie(redirect: string): Promise<{
  state: string;
  cookie: string;
}> {
  const stateBytes = new Uint8Array(16);
  crypto.getRandomValues(stateBytes);
  const state = b64urlEncode(stateBytes);
  const exp = Math.floor(Date.now() / 1000) + 60 * 10; // 10 min
  const cookie = await sign<OAuthStatePayload>({ state, redirect, exp });
  return { state, cookie };
}

export async function readOAuthState(
  token: string | undefined,
): Promise<OAuthStatePayload | null> {
  if (!token) return null;
  return verify<OAuthStatePayload>(token);
}

export function isEmailAllowed(email: string): boolean {
  const raw = process.env.ALLOWED_EMAILS;
  if (!raw || !raw.trim()) return true; // no allowlist → allow any verified Google account
  const list = raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  const e = email.toLowerCase();
  for (const entry of list) {
    if (entry.startsWith("@")) {
      // domain match
      if (e.endsWith(entry)) return true;
    } else if (entry.includes("@")) {
      if (e === entry) return true;
    }
  }
  return false;
}

export function getGoogleClientConfig(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set for OAuth.",
    );
  }
  return { clientId, clientSecret };
}

export function resolveBaseUrl(req: Request): string {
  const envUrl = process.env.AUTH_BASE_URL || process.env.NEXTAUTH_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export function googleAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state: opts.state,
    access_type: "online",
    prompt: "select_account",
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
}
