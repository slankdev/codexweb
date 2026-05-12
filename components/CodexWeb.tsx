"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Task, TaskEvent, TaskStatus } from "@/lib/types";

interface TaskSummary {
  id: string;
  title: string;
  cwd: string;
  status: TaskStatus;
  createdAt: number;
}

interface CurrentUser {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

function summary(t: Task): TaskSummary {
  return { id: t.id, title: t.title, cwd: t.cwd, status: t.status, createdAt: t.createdAt };
}

export function CodexWeb() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<Task | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectTask = useCallback((id: string) => {
    setActiveId(id);
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user as CurrentUser);
      })
      .catch(() => {});
  }, []);

  const refreshTasks = useCallback(async () => {
    const res = await fetch("/api/tasks");
    if (!res.ok) return;
    const data = (await res.json()) as { tasks: Task[] };
    setTasks(data.tasks.map(summary));
  }, []);

  useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  // Subscribe to the active task's event stream.
  useEffect(() => {
    if (!activeId) {
      setActive(null);
      return;
    }
    let cancelled = false;
    let es: EventSource | null = null;
    const seen = new Set<string>();

    (async () => {
      const res = await fetch(`/api/tasks/${activeId}`);
      if (!res.ok || cancelled) return;
      const { task } = (await res.json()) as { task: Task };
      if (cancelled) return;
      for (const ev of task.events) seen.add(ev.id);
      setActive(task);

      es = new EventSource(`/api/tasks/${activeId}/events`);
      es.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as TaskEvent;
          if (seen.has(event.id)) return;
          seen.add(event.id);
          setActive((prev) => {
            if (!prev || prev.id !== activeId) return prev;
            const events = [...prev.events, event];
            let status = prev.status;
            if (event.kind === "status") status = event.status;
            return { ...prev, events, status, updatedAt: event.ts };
          });
          if (event.kind === "status") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === activeId ? { ...t, status: (event as { status: TaskStatus }).status } : t,
              ),
            );
          }
        } catch {
          // ignore
        }
      };
    })();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [activeId]);

  const createTask = useCallback(
    async (input: { prompt: string; cwd: string; model?: string }) => {
      setError(null);
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Failed to create task (${res.status})`);
        return;
      }
      const { task } = (await res.json()) as { task: Task };
      setShowNew(false);
      await refreshTasks();
      setActiveId(task.id);
    },
    [refreshTasks],
  );

  const sendFollowUp = useCallback(
    async (content: string) => {
      if (!activeId) return;
      setError(null);
      const res = await fetch(`/api/tasks/${activeId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Failed to send message (${res.status})`);
      }
    },
    [activeId],
  );

  const stopTask = useCallback(async () => {
    if (!activeId) return;
    setError(null);
    await fetch(`/api/tasks/${activeId}/stop`, { method: "POST" });
  }, [activeId]);

  return (
    <div className={`app${sidebarOpen ? " sidebar-open" : ""}`}>
      <Sidebar
        tasks={tasks}
        activeId={activeId}
        onSelect={selectTask}
        onNew={() => {
          setShowNew(true);
          setSidebarOpen(false);
        }}
        user={user}
      />
      <button
        type="button"
        className="sidebar-backdrop"
        aria-label="サイドバーを閉じる"
        onClick={() => setSidebarOpen(false)}
        tabIndex={sidebarOpen ? 0 : -1}
      />
      <main className="main">
        {active ? (
          <TaskView
            task={active}
            onSend={sendFollowUp}
            onStop={stopTask}
            error={error}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : (
          <>
            <header className="main-header">
              <button
                type="button"
                className="menu-btn"
                aria-label="サイドバーを開く"
                onClick={() => setSidebarOpen(true)}
              >
                ☰
              </button>
              <div className="info">
                <div className="title">Codex Web</div>
              </div>
            </header>
            <div className="center-page">
              <div>左のリストからタスクを選択するか、新しいタスクを作成してください。</div>
              <button className="primary" onClick={() => setShowNew(true)}>
                + 新しいタスク
              </button>
            </div>
          </>
        )}
      </main>

      {showNew && (
        <NewTaskDialog
          onClose={() => setShowNew(false)}
          onSubmit={createTask}
          error={error}
        />
      )}
    </div>
  );
}

function Sidebar({
  tasks,
  activeId,
  onSelect,
  onNew,
  user,
}: {
  tasks: TaskSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  user: CurrentUser | null;
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-title">Codex Web</div>
        <button className="primary" onClick={onNew}>
          + New
        </button>
      </div>
      <div className="sidebar-list">
        {tasks.length === 0 ? (
          <div className="sidebar-empty">タスクがありません</div>
        ) : (
          tasks.map((t) => (
            <div
              key={t.id}
              className={`sidebar-item ${activeId === t.id ? "active" : ""}`}
              onClick={() => onSelect(t.id)}
            >
              <div className="title">{t.title}</div>
              <div className="meta">
                <span className={`status-dot status-${t.status}`} />
                <span>{t.status}</span>
                <span>·</span>
                <span title={t.cwd}>{shortCwd(t.cwd)}</span>
              </div>
            </div>
          ))
        )}
      </div>
      {user && (
        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span className="user-chip" title={user.email}>
            {user.picture ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.picture} alt="" />
            ) : null}
            <span className="email">{user.name || user.email}</span>
          </span>
          <a href="/api/auth/logout" title="ログアウト" style={{ fontSize: 12 }}>
            Logout
          </a>
        </div>
      )}
    </aside>
  );
}

function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length <= 2) return cwd;
  return ".../" + parts.slice(-2).join("/");
}

function TaskView({
  task,
  onSend,
  onStop,
  error,
  onOpenSidebar,
}: {
  task: Task;
  onSend: (content: string) => void;
  onStop: () => void;
  error: string | null;
  onOpenSidebar: () => void;
}) {
  const [draft, setDraft] = useState("");
  const threadRef = useRef<HTMLDivElement>(null);
  const isRunning = task.status === "running" || task.status === "pending";

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [task.events.length]);

  const items = useMemo(() => mergeDeltas(task.events), [task.events]);

  const submit = () => {
    const content = draft.trim();
    if (!content || isRunning) return;
    onSend(content);
    setDraft("");
  };

  return (
    <>
      <header className="main-header">
        <button
          type="button"
          className="menu-btn"
          aria-label="サイドバーを開く"
          onClick={onOpenSidebar}
        >
          ☰
        </button>
        <div className="info">
          <div className="title">{task.title}</div>
          <div className="cwd">{task.cwd}</div>
        </div>
        <div className="header-status">
          <span className={`status-dot status-${task.status}`} />
          <span className="status-label">{task.status}</span>
          {isRunning && (
            <button onClick={onStop} title="Stop">
              停止
            </button>
          )}
        </div>
      </header>

      <div className="thread" ref={threadRef}>
        {items.length === 0 ? (
          <div className="empty-thread">出力を待っています...</div>
        ) : (
          items.map((ev) => <EventItem key={ev.id} event={ev} />)
        )}
      </div>

      <div className="composer">
        {error && <div style={{ color: "var(--error)", fontSize: 12 }}>{error}</div>}
        <div className="composer-row">
          <textarea
            placeholder={
              isRunning
                ? "実行中... 完了後に追加メッセージを送れます"
                : "追加の指示を入力 (Cmd/Ctrl+Enterで送信)"
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            disabled={isRunning}
          />
          <button className="primary send" onClick={submit} disabled={isRunning || !draft.trim()}>
            送信
          </button>
        </div>
      </div>
    </>
  );
}

function EventItem({ event }: { event: TaskEvent }) {
  switch (event.kind) {
    case "user_message":
      return (
        <div className="bubble user">
          <div className="role">You</div>
          <div className="content">{event.content}</div>
        </div>
      );
    case "assistant_message":
      return (
        <div className="bubble assistant">
          <div className="role">Codex</div>
          <div className="content">{event.content}</div>
        </div>
      );
    case "tool_call":
      return (
        <div className="bubble tool">
          <div className="role">tool · {event.name}</div>
          <pre className="content">{formatToolInput(event.input)}</pre>
        </div>
      );
    case "tool_result":
      return (
        <div className={`bubble tool${event.isError ? " error" : ""}`}>
          <div className="role">tool result{event.isError ? " · error" : ""}</div>
          <pre className="content">{event.output}</pre>
        </div>
      );
    case "stdout":
      return (
        <div className="bubble tool">
          <div className="role">stdout</div>
          <pre className="content">{event.content}</pre>
        </div>
      );
    case "stderr":
      return (
        <div className="bubble tool error">
          <div className="role">stderr</div>
          <pre className="content">{event.content}</pre>
        </div>
      );
    case "error":
      return (
        <div className="bubble error">
          <div className="role">error</div>
          <div className="content">{event.message}</div>
        </div>
      );
    case "file_change":
      return (
        <div className="bubble tool">
          <div className="role">file {event.action}</div>
          <div className="content">{event.path}</div>
        </div>
      );
    case "exit":
    case "status":
    case "assistant_delta":
      return null;
  }
}

/**
 * Coalesce `assistant_delta` events into synthesized `assistant_message`
 * events grouped by id, so the UI sees a single streaming bubble per turn.
 */
function mergeDeltas(events: TaskEvent[]): TaskEvent[] {
  const out: TaskEvent[] = [];
  const buffers = new Map<string, { idx: number; text: string }>();

  for (const ev of events) {
    if (ev.kind === "assistant_delta") {
      const existing = buffers.get(ev.id);
      if (existing) {
        existing.text += ev.delta;
        out[existing.idx] = {
          kind: "assistant_message",
          id: ev.id,
          ts: ev.ts,
          content: existing.text,
        };
      } else {
        const synthesized: TaskEvent = {
          kind: "assistant_message",
          id: ev.id,
          ts: ev.ts,
          content: ev.delta,
        };
        buffers.set(ev.id, { idx: out.length, text: ev.delta });
        out.push(synthesized);
      }
      continue;
    }
    if (ev.kind === "assistant_message" && buffers.has(ev.id)) {
      // Final assistant message arrived — replace the synthesized one.
      const entry = buffers.get(ev.id)!;
      out[entry.idx] = ev;
      buffers.delete(ev.id);
      continue;
    }
    out.push(ev);
  }
  return out;
}

function formatToolInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function NewTaskDialog({
  onClose,
  onSubmit,
  error,
}: {
  onClose: () => void;
  onSubmit: (input: { prompt: string; cwd: string; model?: string }) => void;
  error: string | null;
}) {
  const [prompt, setPrompt] = useState("");
  const [cwd, setCwd] = useState("");
  const [model, setModel] = useState("");

  useEffect(() => {
    // Try to suggest a sensible default cwd from the server's environment.
    fetch("/api/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.cwd) setCwd((c) => c || data.cwd);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>新しいタスク</h2>
        <div className="field">
          <label>プロンプト</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例: package.json のスクリプトを README にまとめて"
            autoFocus
          />
        </div>
        <div className="field">
          <label>作業ディレクトリ (絶対パス)</label>
          <input
            value={cwd}
            onChange={(e) => setCwd(e.target.value)}
            placeholder="/path/to/your/project"
          />
        </div>
        <div className="field">
          <label>モデル (任意)</label>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="codex のデフォルトを使用"
          />
        </div>
        {error && <div style={{ color: "var(--error)", fontSize: 12 }}>{error}</div>}
        <div className="actions">
          <button onClick={onClose}>キャンセル</button>
          <button
            className="primary"
            onClick={() => onSubmit({ prompt, cwd, model: model || undefined })}
            disabled={!prompt.trim() || !cwd.trim()}
          >
            実行
          </button>
        </div>
      </div>
    </div>
  );
}
