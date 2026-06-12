// Startup wrapper: seed DB on first boot only (checks actual row count, not local file).
import { db } from './db.js';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const { c: itemCount } = await db.get('SELECT COUNT(*) c FROM items');
const { c: empCount  } = await db.get('SELECT COUNT(*) c FROM employees');

if (itemCount === 0) {
  console.log('Items table is empty — seeding from CSV…');
  const r = spawnSync('node', ['seed.js'], { stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) { console.error('Item seed failed'); process.exit(1); }
}

if (empCount === 0) {
  console.log('Employees table is empty — seeding team…');
  const r = spawnSync('node', ['seed-team.js'], { stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) console.warn('Team seed failed (non-fatal). Continuing without headshots.');
}

await import('./server.js');
