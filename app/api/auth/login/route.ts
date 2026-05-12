import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  buildAuthorizeUrl,
  codeChallengeS256,
  createOAuthStateCookie,
  generateCodeVerifier,
  getOAuthConfig,
  resolveBaseUrl,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirectParam = url.searchParams.get("redirect") || "/";
  const redirect = redirectParam.startsWith("/") ? redirectParam : "/";

  const config = getOAuthConfig();
  const base = resolveBaseUrl(req);
  const redirectUri = `${base}/api/auth/callback`;

  const codeVerifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(codeVerifier);
  const { state, cookie } = await createOAuthStateCookie(redirect, codeVerifier);

  const authUrl = buildAuthorizeUrl({
    config,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  const res = NextResponse.redirect(authUrl);
  res.cookies.set(OAUTH_STATE_COOKIE, cookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https://"),
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
