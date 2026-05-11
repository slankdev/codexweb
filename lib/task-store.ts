import { randomUUID } from "node:crypto";
import { CodexRunner } from "./codex-runner";
import { eventBus } from "./event-bus";
import type { CreateTaskInput, Task, TaskEvent, TaskStatus } from "./types";

interface RunnerEntry {
  runner: CodexRunner;
}

class TaskStore {
  private tasks = new Map<string, Task>();
  private runners = new Map<string, RunnerEntry>();

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  create(input: CreateTaskInput): Task {
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
    this.tasks.set(id, task);
    this.startRunner(task, input.prompt);
    return task;
  }

  followUp(id: string, content: string): boolean {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (this.runners.has(id)) {
      // already running — refuse for now
      return false;
    }
    this.recordEvent(task, {
      kind: "user_message",
      id: randomUUID(),
      ts: Date.now(),
      content,
    });
    this.startRunner(task, content);
    return true;
  }

  stop(id: string): boolean {
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
      if (event.status === "completed" || event.status === "failed" || event.status === "stopped") {
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
  }

  private recordEvent(task: Task, event: TaskEvent): void {
    task.events.push(event);
    task.updatedAt = event.ts;
    eventBus.publish(task.id, event);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __codexweb_task_store: TaskStore | undefined;
}

export const taskStore: TaskStore = globalThis.__codexweb_task_store ?? new TaskStore();
if (!globalThis.__codexweb_task_store) globalThis.__codexweb_task_store = taskStore;
