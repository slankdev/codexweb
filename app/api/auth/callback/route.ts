import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createHandoffToken,
  createSessionCookie,
  getOAuthConfig,
  isEmailAllowed,
  readOAuthState,
  resolveBaseUrl,
  validatePreviewOrigin,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface UserInfo {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");
  const base = resolveBaseUrl(req);

  if (errorParam) {
    return loginErrorRedirect(base, `IdP returned: ${errorParam}`);
  }
  if (!code || !state) {
    return loginErrorRedirect(base, "Missing code/state in callback.");
  }

  const stateCookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(OAUTH_STATE_COOKIE + "="))
    ?.slice(OAUTH_STATE_COOKIE.length + 1);
  const stored = await readOAuthState(stateCookie ? decodeURIComponent(stateCookie) : undefined);
  if (!stored || stored.state !== state) {
    return loginErrorRedirect(base, "Invalid OAuth state.");
  }

  const config = getOAuthConfig();
  const redirectUri = `${base}/api/auth/callback`;

  const tokenParams = new URLSearchParams({
    code,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code_verifier: stored.codeVerifier,
  });
  // PKCE alone is sufficient for public clients; confidential clients
  // (e.g. Google "Web application") additionally require the secret.
  if (config.clientSecret) {
    tokenParams.set("client_secret", config.clientSecret);
  }

  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams,
  });
  const token = (await tokenRes.json()) as TokenResponse;
  if (!tokenRes.ok || !token.access_token) {
    return loginErrorRedirect(
      base,
      `Token exchange failed: ${token.error_description || token.error || tokenRes.status}`,
    );
  }

  const uiRes = await fetch(config.userinfoUrl, {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!uiRes.ok) {
    return loginErrorRedirect(base, `userinfo failed: ${uiRes.status}`);
  }
  const info = (await uiRes.json()) as UserInfo;
  if (!info.email || info.email_verified === false) {
    return loginErrorRedirect(base, "Account email is not verified.");
  }
  if (!isEmailAllowed(info.email)) {
    return loginErrorRedirect(base, `${info.email} is not allowed.`);
  }

  const userPayload = {
    sub: info.sub,
    email: info.email,
    name: info.name,
    picture: info.picture,
  };

  const redirectPath = stored.redirect && stored.redirect.startsWith("/") ? stored.redirect : "/";

  // Re-validate the preview origin from the state cookie. We already
  // validated it at /login time, but operators may have tightened the
  // pattern between then and now — be paranoid and check again.
  const previewOrigin = validatePreviewOrigin(stored.previewOrigin ?? null);

  if (previewOrigin) {
    // Set a canonical-side session too so subsequent preview logins
    // from this browser skip the round-trip through Google.
    const canonicalSession = await createSessionCookie(userPayload);
    const handoff = await createHandoffToken(userPayload);
    const target = new URL(`${previewOrigin}/api/auth/preview-callback`);
    target.searchParams.set("token", handoff);
    target.searchParams.set("redirect", redirectPath);
    const res = NextResponse.redirect(target);
    res.cookies.set(SESSION_COOKIE, canonicalSession, {
      httpOnly: true,
      sameSite: "lax",
      secure: base.startsWith("https://"),
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });
    res.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
    return res;
  }

  const sessionCookie = await createSessionCookie(userPayload);
  const res = NextResponse.redirect(`${base}${redirectPath}`);
  res.cookies.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  res.cookies.set(OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}

function loginErrorRedirect(base: string, message: string) {
  const u = new URL(`${base}/login`);
  u.searchParams.set("error", message);
  return NextResponse.redirect(u.toString());
}
