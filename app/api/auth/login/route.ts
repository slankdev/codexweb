import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  createOAuthStateCookie,
  getGoogleClientConfig,
  googleAuthUrl,
  resolveBaseUrl,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirectParam = url.searchParams.get("redirect") || "/";
  const redirect = redirectParam.startsWith("/") ? redirectParam : "/";

  const { clientId } = getGoogleClientConfig();
  const base = resolveBaseUrl(req);
  const redirectUri = `${base}/api/auth/callback`;

  const { state, cookie } = await createOAuthStateCookie(redirect);
  const authUrl = googleAuthUrl({ clientId, redirectUri, state });

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
