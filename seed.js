import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV = 'WSM Retreat Pick List(Warehouse Supply Count) 2.csv';

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const CATEGORIES = [
  { label: 'Miscellaneous Items',   start: 0 },
  { label: 'Enrichment Retreat',    start: 6 },
  { label: 'Marriage Discipleship', start: 12 },
  { label: 'R&R Retreat',           start: 18 },
];

function parseMoney(raw) {
  if (!raw) return { cost: null, note: null };
  const cleaned = raw.replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  if (!isNaN(num) && /^[\d.\s$,]+$/.test(raw)) return { cost: num, note: null };
  return { cost: null, note: raw.trim() || null };
}

const rows = parseCSV(readFileSync(join(__dirname, CSV), 'utf8'));
const dataRows = rows.slice(1);

const stmts = [{ sql: 'DELETE FROM items', args: [] }];
for (const cat of CATEGORIES) {
  let catOrder = 0;
  for (const row of dataRows) {
    const b = cat.start;
    const name = (row[b + 1] || '').trim();
    if (!name) continue;
    const qtyRaw = (row[b + 2] || '').trim();
    const quantity = qtyRaw === '' ? 0 : (parseInt(qtyRaw.replace(/[^\d-]/g, ''), 10) || 0);
    const vendor = (row[b + 3] || '').trim() || null;
    const { cost, note } = parseMoney(row[b + 4]);
    const hasPic = (row[b] || '').trim().toLowerCase() === 'picture' ? 1 : 0;
    stmts.push({
      sql: 'INSERT INTO items (category, name, quantity, vendor, cost_per_unit, note, has_picture, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [cat.label, name, quantity, vendor, cost, note, hasPic, catOrder++],
    });
  }
}

await db.batch(stmts);

const counts = await Promise.all(
  CATEGORIES.map((c) => db.get('SELECT COUNT(*) c FROM items WHERE category = ?', [c.label]))
);
console.log(`Seeded ${stmts.length - 1} items across ${CATEGORIES.length} categories.`);
CATEGORIES.forEach((c, i) => console.log(`  ${c.label}: ${counts[i].c}`));
