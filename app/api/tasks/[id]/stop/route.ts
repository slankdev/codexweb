import { NextResponse } from "next/server";
import { taskStore } from "@/lib/task-store";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const ok = taskStore.stop(id);
  if (!ok) {
    return NextResponse.json(
      { error: "Task is not running or not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
