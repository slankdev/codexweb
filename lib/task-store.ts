import { randomUUID } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { taskEvents, tasks as tasksTable } from "@/db/schema";
import { CodexRunner } from "./codex-runner";
import { eventBus } from "./event-bus";
import type { CreateTaskInput, Task, TaskEvent, TaskStatus } from "./types";

interface RunnerEntry {
  runner: CodexRunner;
}

// Flush pending event INSERTs at most this often. Codex bursts dozens of
// events per second during a tool call; bulk-inserting keeps DB pressure
// low without making the UI feel laggy (SSE consumers still see events
// immediately — they go through the event bus before they hit the DB).
const EVENT_FLUSH_MS = 100;

interface PendingEvent {
  taskId: string;
  event: TaskEvent;
}

class TaskStore {
  private tasks = new Map<string, Task>();
  private runners = new Map<string, RunnerEntry>();
  private writeBuffer: PendingEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.hydrate().catch((e) => {
      console.error("[task-store] hydrate failed:", e);
    });
  }

  /**
   * Wait until the in-memory cache has been loaded from the DB. The
   * public methods all await this so any API request that hits the
   * store before hydrate finishes blocks instead of returning nothing.
   */
  async whenReady(): Promise<void> {
    await this.ready;
  }

  private async hydrate(): Promise<void> {
    const rows = await db.select().from(tasksTable);
    // Any task left in `running`/`pending` from a previous process
    // is dead — the codex runner died with that revision. Mark them
    // stopped so the UI shows a sensible terminal state.
    const stuck: string[] = [];
    for (const r of rows) {
      const status =
        r.status === "running" || r.status === "pending"
          ? ("stopped" as TaskStatus)
          : (r.status as TaskStatus);
      if (status !== r.status) stuck.push(r.id);
      this.tasks.set(r.id, {
        id: r.id,
        title: r.title,
        prompt: r.prompt,
        cwd: r.cwd,
        model: r.model ?? undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        status,
        events: [],
      });
    }
    if (stuck.length) {
      for (const id of stuck) {
        await db
          .update(tasksTable)
          .set({ status: "stopped", updatedAt: Date.now() })
          .where(eq(tasksTable.id, id));
      }
    }
    console.log(`[task-store] hydrated ${rows.length} tasks (${stuck.length} marked stopped)`);
  }

  async list(): Promise<Task[]> {
    await this.ready;
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async get(id: string): Promise<Task | undefined> {
    await this.ready;
    const task = this.tasks.get(id);
    if (!task) return undefined;
    await this.ensureEventsLoaded(task);
    return task;
  }

  /**
   * Lazy-load events for a task on first access (or after a process
   * restart). Idempotent: if already populated we skip the query.
   */
  private async ensureEventsLoaded(task: Task): Promise<void> {
    if (task.events.length > 0) return;
    const evs = await db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, task.id))
      .orderBy(asc(taskEvents.seq));
    task.events = evs.map((e) => e.payload as TaskEvent);
  }

  async create(input: CreateTaskInput): Promise<Task> {
    await this.ready;
    const id = randomUUID();
    const now = Date.now();
    const title = (input.title ?? input.prompt.slice(0, 60)).trim() || "Untitled task";
    const task: Task = {
      id,
      title,
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model,
      createdAt: now,
      updatedAt: now,
      status: "pending",
      events: [],
    };
    await db.insert(tasksTable).values({
      id,
      title,
      prompt: input.prompt,
      cwd: input.cwd,
      model: input.model ?? null,
      status: task.status,
      createdAt: now,
      updatedAt: now,
    });
    this.tasks.set(id, task);
    this.startRunner(task, input.prompt);
    return task;
  }

  async followUp(id: string, content: string): Promise<boolean> {
    await this.ready;
    const task = this.tasks.get(id);
    if (!task) return false;
    if (this.runners.has(id)) return false;
    // Pull prior history into memory so the SSE replay later sees the
    // full conversation, not just the events from this follow-up.
    await this.ensureEventsLoaded(task);
    this.recordEvent(task, {
      kind: "user_message",
      id: randomUUID(),
      ts: Date.now(),
      content,
    });
    this.startRunner(task, content);
    return true;
  }

  async stop(id: string): Promise<boolean> {
    await this.ready;
    const entry = this.runners.get(id);
    if (!entry) return false;
    entry.runner.stop();
    return true;
  }

  private startRunner(task: Task, prompt: string): void {
    this.setStatus(task, "running");
    const runner = new CodexRunner({
      prompt,
      cwd: task.cwd,
      model: task.model,
      onEvent: (event) => this.handleRunnerEvent(task.id, event),
    });
    this.runners.set(task.id, { runner });
    runner.start();
  }

  private handleRunnerEvent(taskId: string, event: TaskEvent): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.recordEvent(task, event);
    if (event.kind === "status") {
      task.status = event.status;
      if (
        event.status === "completed" ||
        event.status === "failed" ||
        event.status === "stopped"
      ) {
        this.runners.delete(taskId);
      }
    }
    if (event.kind === "exit") {
      this.runners.delete(taskId);
    }
  }

  private setStatus(task: Task, status: TaskStatus): void {
    task.status = status;
    task.updatedAt = Date.now();
    const event: TaskEvent = {
      kind: "status",
      id: randomUUID(),
      ts: task.updatedAt,
      status,
    };
    task.events.push(event);
    eventBus.publish(task.id, event);
    this.scheduleWrite(task.id, event, task);
  }

  private recordEvent(task: Task, event: TaskEvent): void {
    task.events.push(event);
    task.updatedAt = event.ts;
    eventBus.publish(task.id, event);
    this.scheduleWrite(task.id, event, task);
  }

  private scheduleWrite(taskId: string, event: TaskEvent, task: Task): void {
    this.writeBuffer.push({ taskId, event });
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, EVENT_FLUSH_MS);
    // Stash the task ref so flush can update its row too. We deduplicate
    // by id when flushing.
    void task;
  }

  private async flush(): Promise<void> {
    if (this.writeBuffer.length === 0) return;
    const batch = this.writeBuffer;
    this.writeBuffer = [];

    // Latest status / updated_at per task — collapse so we issue one
    // UPDATE per task at the end of the batch.
    const taskUpdates = new Map<string, { status: TaskStatus; updatedAt: number }>();
    const rows = batch.map(({ taskId, event }) => {
      const t = this.tasks.get(taskId);
      if (t) taskUpdates.set(taskId, { status: t.status, updatedAt: t.updatedAt });
      return {
        id: event.id,
        taskId,
        ts: event.ts,
        kind: event.kind,
        payload: event,
      };
    });

    try {
      // Idempotent insert — if the same event id surfaces twice (e.g.
      // after a retry) we want the row already there, not an error.
      // `id = id` is a no-op update that turns the conflict into a
      // silent skip on MySQL.
      await db
        .insert(taskEvents)
        .values(rows)
        .onDuplicateKeyUpdate({ set: { id: sql`id` } });
      for (const [id, u] of taskUpdates) {
        await db
          .update(tasksTable)
          .set({ status: u.status, updatedAt: u.updatedAt })
          .where(eq(tasksTable.id, id));
      }
    } catch (e) {
      console.error("[task-store] flush error:", e);
      // Put the events back on the buffer for the next tick. Avoid
      // unbounded growth — drop after 1000 outstanding events.
      if (this.writeBuffer.length < 1000) {
        this.writeBuffer.unshift(...batch);
        if (!this.flushTimer) {
          this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            void this.flush();
          }, EVENT_FLUSH_MS * 5);
        }
      }
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __codexweb_task_store: TaskStore | undefined;
}

export const taskStore: TaskStore = globalThis.__codexweb_task_store ?? new TaskStore();
if (!globalThis.__codexweb_task_store) globalThis.__codexweb_task_store = taskStore;
