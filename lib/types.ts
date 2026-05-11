export type TaskStatus = "pending" | "running" | "completed" | "failed" | "stopped";

export type TaskEvent =
  | { kind: "user_message"; id: string; ts: number; content: string }
  | { kind: "assistant_message"; id: string; ts: number; content: string }
  | { kind: "assistant_delta"; id: string; ts: number; delta: string }
  | { kind: "tool_call"; id: string; ts: number; name: string; input: unknown }
  | { kind: "tool_result"; id: string; ts: number; callId: string; output: string; isError?: boolean }
  | { kind: "file_change"; id: string; ts: number; path: string; diff?: string; action: "create" | "modify" | "delete" }
  | { kind: "stdout"; id: string; ts: number; content: string }
  | { kind: "stderr"; id: string; ts: number; content: string }
  | { kind: "status"; id: string; ts: number; status: TaskStatus }
  | { kind: "error"; id: string; ts: number; message: string }
  | { kind: "exit"; id: string; ts: number; code: number | null };

export interface Task {
  id: string;
  title: string;
  prompt: string;
  cwd: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  status: TaskStatus;
  events: TaskEvent[];
}

export interface CreateTaskInput {
  prompt: string;
  cwd: string;
  model?: string;
  title?: string;
}

export interface FollowUpInput {
  content: string;
}
