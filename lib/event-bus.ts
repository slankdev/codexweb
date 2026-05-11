import type { TaskEvent } from "./types";

type Listener = (event: TaskEvent) => void;

/**
 * Per-task in-process pub/sub for streaming events to SSE subscribers.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(taskId: string, listener: Listener): () => void {
    let set = this.listeners.get(taskId);
    if (!set) {
      set = new Set();
      this.listeners.set(taskId, set);
    }
    set.add(listener);
    return () => {
      const s = this.listeners.get(taskId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.listeners.delete(taskId);
    };
  }

  publish(taskId: string, event: TaskEvent): void {
    const set = this.listeners.get(taskId);
    if (!set) return;
    for (const l of set) {
      try {
        l(event);
      } catch {
        // ignore listener errors
      }
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __codexweb_event_bus: EventBus | undefined;
}

export const eventBus: EventBus = globalThis.__codexweb_event_bus ?? new EventBus();
if (!globalThis.__codexweb_event_bus) globalThis.__codexweb_event_bus = eventBus;
