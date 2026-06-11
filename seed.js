import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV = 'WSM Retreat Pick List(Warehouse Supply Count) 2.csv';

// --- minimal CSV parser (handles quoted fields) ---
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

// The sheet lays out 4 retreat categories side by side, each a 6-column block:
// [pictureFlag, name, quantity, vendor, cost/note, spacer]
const CATEGORIES = [
  { label: 'Miscellaneous Items',        start: 0 },
  { label: 'Enrichment Retreat',         start: 6 },
  { label: 'Marriage Discipleship',      start: 12 },
  { label: 'R&R Retreat',                start: 18 },
];

function parseMoney(raw) {
  if (!raw) return { cost: null, note: null };
  const cleaned = raw.replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  // A real price parses cleanly; anything else (e.g. "one time purchase") is a note.
  if (!isNaN(num) && /^[\d.\s$,]+$/.test(raw)) return { cost: num, note: null };
  return { cost: null, note: raw.trim() || null };
}

const rows = parseCSV(readFileSync(join(__dirname, CSV), 'utf8'));
const dataRows = rows.slice(1); // drop header

const insert = db.prepare(`
  INSERT INTO items (category, name, quantity, vendor, cost_per_unit, note, has_picture, sort_order)
  VALUES (@category, @name, @quantity, @vendor, @cost_per_unit, @note, @has_picture, @sort_order)
`);

db.exec('DELETE FROM items');
let order = 0, count = 0;

const seed = db.transaction(() => {
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
      insert.run({
        category: cat.label,
        name,
        quantity,
        vendor,
        cost_per_unit: cost,
        note,
        has_picture: hasPic,
        sort_order: catOrder++,
      });
      order++; count++;
    }
  }
});

seed();
console.log(`Seeded ${count} items across ${CATEGORIES.length} categories.`);
for (const cat of CATEGORIES) {
  const n = db.prepare('SELECT COUNT(*) c FROM items WHERE category = ?').get(cat.label).c;
  console.log(`  ${cat.label}: ${n}`);
}
