import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/auth";

export const config = {
  // Match everything except Next internals and static assets. The matcher
  // protects both pages and API routes; we then explicitly let through the
  // /login page and /api/auth/* endpoints inside the function below.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};

const PUBLIC_PATHS = ["/login"];
const PUBLIC_API_PREFIX = "/api/auth/";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith(PUBLIC_API_PREFIX)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = await readSession(token);
  if (session) return NextResponse.next();

  const isApi = pathname.startsWith("/api/");
  if (isApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?redirect=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}
