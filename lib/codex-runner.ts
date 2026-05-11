import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, existsSync, realpathSync, statSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import type { TaskEvent } from "./types";

export interface CodexRunnerOptions {
  prompt: string;
  cwd: string;
  model?: string;
  /** Override codex binary. Defaults to env CODEX_BIN, vendor/codex bin, then "codex". */
  bin?: string;
  /** Extra args passed verbatim. */
  extraArgs?: string[];
  onEvent: (event: TaskEvent) => void;
}

/**
 * Resolve the codex executable to spawn.
 *
 * Priority:
 *   1. opts.bin
 *   2. CODEX_BIN env
 *   3. ./vendor/codex/codex-cli/bin/codex (if submodule is built)
 *   4. "codex" (assumes it is on PATH)
 */
export function resolveCodexBin(opts: { bin?: string } = {}): string {
  if (opts.bin) return opts.bin;
  if (process.env.CODEX_BIN) return process.env.CODEX_BIN;
  const vendored = resolve(process.cwd(), "vendor/codex/codex-cli/bin/codex.js");
  if (existsSync(vendored)) return vendored;
  return "codex";
}

/**
 * Find a bare command on PATH (poor man's `which`). Returns null if missing.
 */
function whichOnPath(name: string): string | null {
  if (name.includes("/")) return existsSync(name) ? name : null;
  const PATH = process.env.PATH ?? "";
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE").split(";")
      : [""];
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * Decide how to launch the codex binary. If the resolved path is a Node
 * script (e.g. an `npm i -g @openai/codex` symlink that points to a `.js`
 * file lacking the +x bit), invoke it via `node` so we don't depend on
 * the file's executable permission.
 */
export function buildSpawnCommand(requested: string): {
  command: string;
  prefixArgs: string[];
} {
  const resolved = whichOnPath(requested) ?? requested;
  let real = resolved;
  try {
    real = realpathSync(resolved);
  } catch {
    // not a real path yet (bare name not on PATH) — let spawn fail naturally
  }
  if (/\.(c?js|mjs)$/i.test(real)) {
    return { command: process.execPath, prefixArgs: [real] };
  }
  return { command: requested, prefixArgs: [] };
}

/**
 * Run `codex exec` for the given prompt and stream events.
 *
 * Codex CLI's exec mode prints structured events when invoked with `--json`.
 * Each line of stdout is expected to be a JSON object. If the line is not
 * valid JSON we fall back to emitting it as a plain stdout event so the user
 * still sees the output.
 */
export class CodexRunner {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buf = "";

  constructor(private readonly opts: CodexRunnerOptions) {}

  start(): void {
    const requested = resolveCodexBin({ bin: this.opts.bin });
    const { command, prefixArgs } = buildSpawnCommand(requested);
    // `--skip-git-repo-check`: the user explicitly chose the cwd from the
    //   web UI, so we treat the parent webapp as the trust boundary rather
    //   than relying on codex's "must be a git repo" guard.
    const args = [...prefixArgs, "exec", "--json", "--skip-git-repo-check"];
    if (this.opts.model) args.push("--model", this.opts.model);
    if (this.opts.extraArgs?.length) args.push(...this.opts.extraArgs);
    // Prompt is passed via stdin to avoid argv length / quoting issues.
    args.push("-");

    const cwdError = checkCwd(this.opts.cwd);
    if (cwdError) {
      this.emit({ kind: "error", id: randomUUID(), ts: Date.now(), message: cwdError });
      this.emit({ kind: "status", id: randomUUID(), ts: Date.now(), status: "failed" });
      return;
    }

    let proc: ChildProcessWithoutNullStreams;
    try {
      proc = spawn(command, args, {
        cwd: this.opts.cwd,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      this.emit({
        kind: "error",
        id: randomUUID(),
        ts: Date.now(),
        message: `Failed to spawn codex (${command}): ${(err as Error).message}`,
      });
      this.emit({ kind: "status", id: randomUUID(), ts: Date.now(), status: "failed" });
      return;
    }

    this.proc = proc;

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");

    proc.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    proc.stderr.on("data", (chunk: string) => {
      this.emit({ kind: "stderr", id: randomUUID(), ts: Date.now(), content: chunk });
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      const hint = hintForSpawnError(err, command);
      this.emit({
        kind: "error",
        id: randomUUID(),
        ts: Date.now(),
        message: `Codex process error (${command}): ${err.message}${hint ? `\n${hint}` : ""}`,
      });
    });

    proc.on("exit", (code) => {
      // Drain any pending buffered line.
      if (this.buf.trim().length > 0) {
        this.onLine(this.buf);
        this.buf = "";
      }
      this.emit({ kind: "exit", id: randomUUID(), ts: Date.now(), code });
      this.emit({
        kind: "status",
        id: randomUUID(),
        ts: Date.now(),
        status: code === 0 ? "completed" : "failed",
      });
      this.proc = null;
    });

    // Write the prompt and close stdin so codex begins processing.
    try {
      proc.stdin.write(this.opts.prompt);
      if (!this.opts.prompt.endsWith("\n")) proc.stdin.write("\n");
      proc.stdin.end();
    } catch (err) {
      this.emit({
        kind: "error",
        id: randomUUID(),
        ts: Date.now(),
        message: `Failed to write prompt: ${(err as Error).message}`,
      });
    }
  }

  stop(): void {
    if (!this.proc) return;
    try {
      this.proc.kill("SIGTERM");
    } catch {
      // ignore
    }
    this.emit({ kind: "status", id: randomUUID(), ts: Date.now(), status: "stopped" });
  }

  private onStdout(chunk: string): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      if (line.trim().length === 0) continue;
      this.onLine(line);
    }
  }

  private onLine(line: string): void {
    const parsed = tryParseJson(line);
    if (!parsed) {
      this.emit({ kind: "stdout", id: randomUUID(), ts: Date.now(), content: line });
      return;
    }
    const event = mapCodexEvent(parsed);
    if (event) {
      this.emit(event);
    } else {
      this.emit({ kind: "stdout", id: randomUUID(), ts: Date.now(), content: line });
    }
  }

  private emit(event: TaskEvent): void {
    try {
      this.opts.onEvent(event);
    } catch {
      // never let listener errors crash the runner
    }
  }
}

function hintForSpawnError(err: NodeJS.ErrnoException, bin: string): string | null {
  switch (err.code) {
    case "ENOENT":
      return `Hint: "${bin}" was not found on PATH. Install the codex CLI (e.g. \`npm i -g @openai/codex\`) or set CODEX_BIN to its absolute path.`;
    case "EACCES":
      return `Hint: "${bin}" or the task's cwd is not accessible for the running user. If you're running the container with -v <host>:<path>, make sure the host directory is traversable for the container's UID, or pass \`--user 0\` (rootless Docker/Podman maps the host user to container root).`;
    case "ENOEXEC":
      return `Hint: "${bin}" is not in an executable format for this CPU architecture.`;
    default:
      return null;
  }
}

/**
 * Validate that the task's working directory exists and is searchable for
 * the current process. Otherwise `spawn` will fail at chdir-time and Node
 * reports it as `spawn <bin> EACCES/ENOENT`, which is misleading.
 */
function checkCwd(cwd: string): string | null {
  if (!cwd) return "Working directory is empty.";
  let st;
  try {
    st = statSync(cwd);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return `Working directory "${cwd}" does not exist (in the codexweb server's view — if running in a container, was it bind-mounted?).`;
    }
    if (err.code === "EACCES") {
      return `Working directory "${cwd}" is not accessible to the codexweb server process. If running in a container, check that the bind-mount permissions allow the container UID, or run with \`--user 0\`.`;
    }
    return `Cannot stat working directory "${cwd}": ${err.message}`;
  }
  if (!st.isDirectory()) {
    return `Working directory "${cwd}" exists but is not a directory.`;
  }
  try {
    accessSync(cwd, constants.R_OK | constants.X_OK);
  } catch {
    return `Working directory "${cwd}" exists but is not readable/traversable by the codexweb server process. If running in a container with a bind mount, ensure the mount permits the container UID (try \`--user 0\`).`;
  }
  return null;
}

function tryParseJson(line: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(line);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort mapping from Codex CLI's `--json` output to our TaskEvent shape.
 *
 * The Codex CLI emits events with at least a `type` (or `kind`) discriminator.
 * Field names vary across versions; we accept several aliases. Unknown event
 * types are dropped and the raw line is emitted as `stdout` by the caller.
 */
function mapCodexEvent(raw: Record<string, unknown>): TaskEvent | null {
  const ts = Date.now();
  const id = (raw.id as string) ?? randomUUID();
  const type = (raw.type as string) ?? (raw.kind as string) ?? "";

  const text =
    (raw.text as string) ??
    (raw.content as string) ??
    (raw.message as string) ??
    "";

  switch (type) {
    case "assistant_message":
    case "agent_message":
    case "message":
      return { kind: "assistant_message", id, ts, content: text };

    case "assistant_delta":
    case "agent_message_delta":
    case "message_delta":
    case "delta":
      return {
        kind: "assistant_delta",
        id,
        ts,
        delta: (raw.delta as string) ?? text,
      };

    case "user_message":
    case "user_input":
      return { kind: "user_message", id, ts, content: text };

    case "tool_call":
    case "function_call":
    case "tool_use": {
      const name = (raw.name as string) ?? (raw.tool as string) ?? "tool";
      const input = (raw.input as unknown) ?? (raw.arguments as unknown) ?? raw;
      return { kind: "tool_call", id, ts, name, input };
    }

    case "tool_result":
    case "function_result":
    case "tool_output": {
      const callId = (raw.call_id as string) ?? (raw.callId as string) ?? id;
      const output =
        (raw.output as string) ??
        (raw.result as string) ??
        text ??
        "";
      return {
        kind: "tool_result",
        id,
        ts,
        callId,
        output: typeof output === "string" ? output : JSON.stringify(output),
        isError: Boolean(raw.is_error ?? raw.isError),
      };
    }

    case "file_change":
    case "file_patch":
    case "patch": {
      const path = (raw.path as string) ?? (raw.file as string) ?? "?";
      const diff = (raw.diff as string) ?? (raw.patch as string) ?? undefined;
      const action = ((raw.action as string) ?? "modify") as "create" | "modify" | "delete";
      return { kind: "file_change", id, ts, path, diff, action };
    }

    case "error":
      return {
        kind: "error",
        id,
        ts,
        message: (raw.message as string) ?? (raw.error as string) ?? "Unknown error",
      };

    case "stdout":
      return { kind: "stdout", id, ts, content: text };
    case "stderr":
      return { kind: "stderr", id, ts, content: text };

    default:
      return null;
  }
}
