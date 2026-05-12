import {
  bigint,
  index,
  json,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

export const tasks = mysqlTable("tasks", {
  id: varchar("id", { length: 36 }).primaryKey(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  cwd: text("cwd").notNull(),
  model: varchar("model", { length: 255 }),
  status: varchar("status", { length: 20 }).notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export const taskEvents = mysqlTable(
  "task_events",
  {
    // Auto-incremented sequence — used to order events deterministically
    // even when the codex-side timestamps collide on coarse system clocks.
    seq: bigint("seq", { mode: "number" }).autoincrement().primaryKey(),
    // The codex-side event id (UUID). Kept unique so re-inserts are
    // idempotent if the runner replays.
    id: varchar("id", { length: 36 }).notNull().unique(),
    taskId: varchar("task_id", { length: 36 })
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    ts: bigint("ts", { mode: "number" }).notNull(),
    kind: varchar("kind", { length: 40 }).notNull(),
    payload: json("payload").notNull(),
  },
  (t) => ({
    taskSeqIdx: index("idx_task_seq").on(t.taskId, t.seq),
  }),
);

export type DbTask = typeof tasks.$inferSelect;
export type DbTaskEvent = typeof taskEvents.$inferSelect;
