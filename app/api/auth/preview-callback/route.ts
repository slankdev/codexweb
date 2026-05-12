// Consumes the short-lived handoff token a canonical app emits after
// the OAuth dance, exchanging it for a session cookie on this (preview)
// origin. Used by the auth-proxy flow described in lib/auth.ts.

import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  createSessionCookie,
  isEmailAllowed,
  readHandoffToken,
  resolveBaseUrl,
} from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = resolveBaseUrl(req);
  const token = url.searchParams.get("token");
  const redirectParam = url.searchParams.get("redirect") || "/";
  const redirect = redirectParam.startsWith("/") ? redirectParam : "/";

  const handoff = await readHandoffToken(token ?? undefined);
  if (!handoff) {
    return errorRedirect(base, "Invalid or expired handoff token.");
  }
  // Apply the local allowlist as a defence in depth — the canonical
  // app already enforces ALLOWED_EMAILS but the preview may have a
  // narrower list configured.
  if (!isEmailAllowed(handoff.email)) {
    return errorRedirect(base, `${handoff.email} is not allowed on this preview.`);
  }

  const sessionCookie = await createSessionCookie({
    sub: handoff.sub,
    email: handoff.email,
    name: handoff.name,
    picture: handoff.picture,
  });
  const res = NextResponse.redirect(`${base}${redirect}`);
  res.cookies.set(SESSION_COOKIE, sessionCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: base.startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return res;
}

function errorRedirect(base: string, message: string) {
  const u = new URL(`${base}/login`);
  u.searchParams.set("error", message);
  return NextResponse.redirect(u.toString());
}
