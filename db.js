import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use Turso remote when env vars are set (production), local SQLite file for dev.
const client = createClient(
  process.env.TURSO_DATABASE_URL
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: `file:${join(__dirname, 'data.db')}` }
);

function rowToObj(row) {
  if (!row) return undefined;
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])
  );
}

// Thin async wrapper — mirrors the better-sqlite3 API shape used in the rest of the app.
export const db = {
  async all(sql, args = []) {
    const r = await client.execute({ sql, args });
    return r.rows.map(rowToObj);
  },
  async get(sql, args = []) {
    const r = await client.execute({ sql, args });
    return rowToObj(r.rows[0]);
  },
  async run(sql, args = []) {
    const r = await client.execute({ sql, args });
    return { lastInsertRowid: Number(r.lastInsertRowid ?? 0), changes: r.rowsAffected ?? 0 };
  },
  async batch(stmts) {
    // stmts: Array<{ sql, args }>
    return client.batch(stmts, 'write');
  },
};

// --- Schema (idempotent) ---
for (const stmt of [
  `CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    quantity      INTEGER NOT NULL DEFAULT 0,
    vendor        TEXT,
    cost_per_unit REAL,
    note          TEXT,
    has_picture   INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    image_path    TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS checkouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER,
    item_name   TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    quantity    INTEGER NOT NULL,
    person_name TEXT    NOT NULL,
    notes       TEXT,
    kind        TEXT    NOT NULL DEFAULT 'checkout',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS employees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    photo_path TEXT
  )`,
]) {
  await client.execute(stmt);
}
