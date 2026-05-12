import { NextResponse } from "next/server";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  buildAuthorizeUrl,
  codeChallengeS256,
  createHandoffToken,
  createOAuthStateCookie,
  generateCodeVerifier,
  getOAuthConfig,
  readSession,
  resolveBaseUrl,
  validatePreviewOrigin,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirectParam = url.searchParams.get("redirect") || "/";
  const redirect = redirectParam.startsWith("/") ? redirectParam : "/";
  const previewOrigin = validatePreviewOrigin(url.searchParams.get("preview"));

  // If the caller is a PR preview and we (canonical) already have a
  // valid session for the user, skip the round-trip through Google and
  // mint a handoff straight away.
  if (previewOrigin) {
    const sessionToken = req.headers
      .get("cookie")
      ?.split(/;\s*/)
      .find((c) => c.startsWith(SESSION_COOKIE + "="))
      ?.slice(SESSION_COOKIE.length + 1);
    const session = await readSession(
      sessionToken ? decodeURIComponent(sessionToken) : undefined,
    );
    if (session) {
      const handoff = await createHandoffToken({
        sub: session.sub,
        email: session.email,
        name: session.name,
        picture: session.picture,
      });
      const target = new URL(`${previewOrigin}/api/auth/preview-callback`);
      target.searchParams.set("token", handoff);
      target.searchParams.set("redirect", redirect);
      return NextResponse.redirect(target);
    }
  }

  const config = getOAuthConfig();
  const base = resolveBaseUrl(req);
  const redirectUri = `${base}/api/auth/callback`;

  const codeVerifier = generateCodeVerifier();
  const challenge = await codeChallengeS256(codeVerifier);
  const { state, cookie } = await createOAuthStateCookie(
    redirect,
    codeVerifier,
    previewOrigin ?? undefined,
  );

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
