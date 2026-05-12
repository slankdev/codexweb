import { NextResponse } from "next/server";
import { SESSION_COOKIE, resolveBaseUrl } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  return clearAndRedirect(req);
}

export async function GET(req: Request) {
  return clearAndRedirect(req);
}

function clearAndRedirect(req: Request) {
  const base = resolveBaseUrl(req);
  const res = NextResponse.redirect(`${base}/login`);
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
