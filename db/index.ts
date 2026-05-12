// MySQL connection + drizzle instance.
//
// Connection string is read from DATABASE_URL. Two shapes are supported:
//
//   1. TCP / hostname:
//        mysql://user:pass@host:3306/codexweb
//      Used in local dev (docker compose, etc.).
//
//   2. Unix socket (Cloud Run + Cloud SQL):
//        mysql://user:pass@localhost/codexweb?socketPath=/cloudsql/PROJECT:REGION:INSTANCE
//      mysql2 honours `socketPath` from the URL query.
//
// We lazy-initialise the pool so importing this module during `next
// build` (where DATABASE_URL isn't expected to be set) doesn't blow up.

import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

let _pool: mysql.Pool | null = null;
let _db: MySql2Database<typeof schema> | null = null;

function getPool(): mysql.Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  _pool = mysql.createPool({
    uri: url,
    connectionLimit: 5,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  return _pool;
}

/**
 * Proxy that defers pool/drizzle creation until the first property
 * access. This keeps `import { db } from "@/db"` cheap and lets the
 * module load on machines without DATABASE_URL.
 */
export const db = new Proxy({} as MySql2Database<typeof schema>, {
  get(_target, prop) {
    if (!_db) _db = drizzle(getPool(), { schema, mode: "default" });
    return Reflect.get(_db, prop, _db);
  },
});
