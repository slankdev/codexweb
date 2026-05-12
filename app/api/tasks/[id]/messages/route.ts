import { NextResponse } from "next/server";
import { taskStore } from "@/lib/task-store";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const ok = await taskStore.followUp(id, content);
  if (!ok) {
    return NextResponse.json(
      { error: "Task is not ready for a follow-up (not found, or still running)." },
      { status: 409 },
    );
  }
  return NextResponse.json({ ok: true });
}
