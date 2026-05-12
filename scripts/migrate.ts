// Tiny SQL migration runner.
//
// Applies every `db/migrations/*.sql` file once, in lexicographic order.
// Track which files have been applied in a `_migrations` bookkeeping
// table inside the same database. Re-running is a no-op.
//
// Invoked from CI before deploying a new Cloud Run revision.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const dir = resolve(process.cwd(), "db/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.log("No migrations.");
    return;
  }

  const conn = await mysql.createConnection({
    uri: url,
    multipleStatements: true,
  });

  await conn.query(
    `CREATE TABLE IF NOT EXISTS _migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  );

  const [rows] = (await conn.query("SELECT name FROM _migrations")) as [
    Array<{ name: string }>,
    unknown,
  ];
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`);
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf-8");
    console.log(`apply  ${file}`);
    await conn.query(sql);
    await conn.query("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)", [
      file,
      Date.now(),
    ]);
  }

  await conn.end();
  console.log("Migrations applied.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
