import { NextResponse } from "next/server";
import { taskStore } from "@/lib/task-store";
import type { CreateTaskInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ tasks: taskStore.list() });
}

export async function POST(req: Request) {
  let body: Partial<CreateTaskInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
  if (!prompt) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  if (!cwd) return NextResponse.json({ error: "cwd is required" }, { status: 400 });

  const task = taskStore.create({
    prompt,
    cwd,
    model: typeof body.model === "string" && body.model ? body.model : undefined,
    title: typeof body.title === "string" && body.title ? body.title : undefined,
  });
  return NextResponse.json({ task }, { status: 201 });
}
