import { eventBus } from "@/lib/event-bus";
import { taskStore } from "@/lib/task-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const task = await taskStore.get(id);
  if (!task) return new Response("Not found", { status: 404 });

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const write = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          // closed
        }
      };

      const send = (event: unknown) => {
        write(`data: ${JSON.stringify(event)}\n\n`);
      };

      // Replay buffered events so a late subscriber sees full history.
      for (const ev of task.events) send(ev);

      const unsubscribe = eventBus.subscribe(id, (ev) => send(ev));

      // Heartbeat keeps the connection alive through proxies.
      const heartbeat = setInterval(() => write(": ping\n\n"), 15_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Abort handling — close on client disconnect.
      const abort = (_req as Request).signal;
      abort?.addEventListener("abort", close, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
