import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    cwd: process.env.CODEX_DEFAULT_CWD || process.cwd(),
  });
}
