import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const db = new Database(join(__dirname, 'data.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    category      TEXT    NOT NULL,
    name          TEXT    NOT NULL,
    quantity      INTEGER NOT NULL DEFAULT 0,
    vendor        TEXT,
    cost_per_unit REAL,
    note          TEXT,
    has_picture   INTEGER NOT NULL DEFAULT 0,
    archived      INTEGER NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS checkouts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER,
    item_name   TEXT    NOT NULL,
    category    TEXT    NOT NULL,
    quantity    INTEGER NOT NULL,
    person_name TEXT    NOT NULL,
    notes       TEXT,
    kind        TEXT    NOT NULL DEFAULT 'checkout',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS employees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    active     INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
`);

// --- migrations (idempotent) ---
const itemCols = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
if (!itemCols.includes('image_path')) {
  db.exec('ALTER TABLE items ADD COLUMN image_path TEXT');
}
const empCols = db.prepare('PRAGMA table_info(employees)').all().map((c) => c.name);
if (!empCols.includes('photo_path')) {
  db.exec('ALTER TABLE employees ADD COLUMN photo_path TEXT');
}

// Seed a starter roster the first time so the form's name picker isn't empty.
// These are placeholders — manage the real list under the admin "Team" tab.
if (db.prepare('SELECT COUNT(*) c FROM employees').get().c === 0) {
  const ins = db.prepare('INSERT INTO employees (name, sort_order) VALUES (?, ?)');
  ['Alex Carter', 'Casey Nguyen', 'Jordan Lee', 'Morgan Ellis', 'Taylor Reed']
    .forEach((n, i) => ins.run(n, i));
}
