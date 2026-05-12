// Lightweight OAuth 2.0 (Authorization Code + PKCE) + session helpers.
//
// IdP-agnostic: defaults to Google but every endpoint is overridable via
// OAUTH_* env vars. PKCE (S256) is always applied. `OAUTH_CLIENT_SECRET`
// is optional — set it for confidential clients that require it
// (e.g. Google "Web application" type), leave it unset for public
// clients (Auth0/Keycloak/Cognito SPA/Native, etc.).
//
// Sessions and OAuth state cookies are HMAC-signed via Web Crypto, so the
// same helpers run in the Edge runtime (middleware) and Node runtime
// (route handlers).

export const SESSION_COOKIE = "codexweb_session";
export const OAUTH_STATE_COOKIE = "codexweb_oauth_state";

export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const DEFAULT_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const DEFAULT_SCOPES = "openid email profile";

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
  codeVerifier: string;
  exp: number;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;
  authorizeUrl: string;
  tokenUrl: string;
  userinfoUrl: string;
  scopes: string;
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

// ---------- PKCE -------------------------------------------------------

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

export function generateCodeVerifier(): string {
  // 32 random bytes → 43-char base64url string, well within RFC 7636 limits.
  return b64urlEncode(randomBytes(32));
}

export async function codeChallengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return b64urlEncode(new Uint8Array(digest));
}

// ---------- OAuth state cookie ----------------------------------------

export async function createOAuthStateCookie(
  redirect: string,
  codeVerifier: string,
): Promise<{ state: string; cookie: string }> {
  const state = b64urlEncode(randomBytes(16));
  const exp = Math.floor(Date.now() / 1000) + 60 * 10; // 10 min
  const cookie = await sign<OAuthStatePayload>({
    state,
    redirect,
    codeVerifier,
    exp,
  });
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
  if (!raw || !raw.trim()) return true;
  const list = raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return true;
  const e = email.toLowerCase();
  for (const entry of list) {
    if (entry.startsWith("@")) {
      if (e.endsWith(entry)) return true;
    } else if (entry.includes("@")) {
      if (e === entry) return true;
    }
  }
  return false;
}

export function getOAuthConfig(): OAuthConfig {
  const clientId = process.env.OAUTH_CLIENT_ID;
  if (!clientId) {
    throw new Error("OAUTH_CLIENT_ID must be set.");
  }
  return {
    clientId,
    clientSecret: process.env.OAUTH_CLIENT_SECRET || undefined,
    authorizeUrl: process.env.OAUTH_AUTHORIZE_URL || DEFAULT_AUTHORIZE_URL,
    tokenUrl: process.env.OAUTH_TOKEN_URL || DEFAULT_TOKEN_URL,
    userinfoUrl: process.env.OAUTH_USERINFO_URL || DEFAULT_USERINFO_URL,
    scopes: process.env.OAUTH_SCOPES || DEFAULT_SCOPES,
  };
}

export function resolveBaseUrl(req: Request): string {
  const envUrl = process.env.AUTH_BASE_URL;
  if (envUrl) return envUrl.replace(/\/$/, "");
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export function buildAuthorizeUrl(opts: {
  config: OAuthConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.config.clientId,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.config.scopes,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    access_type: "online",
    prompt: "select_account",
  });
  return opts.config.authorizeUrl + "?" + params.toString();
}
