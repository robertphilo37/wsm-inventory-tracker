// Startup wrapper: auto-seed DB on first boot, then launch the server.
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'data.db');

if (!existsSync(dbPath)) {
  console.log('No database found — seeding items from CSV...');
  const seed = spawnSync('node', ['seed.js'], { stdio: 'inherit', cwd: __dirname });
  if (seed.status !== 0) { console.error('Seed failed'); process.exit(1); }

  console.log('Seeding team from WinShape Marriage website...');
  const team = spawnSync('node', ['seed-team.js'], { stdio: 'inherit', cwd: __dirname });
  if (team.status !== 0) {
    // Non-fatal — the app works fine without headshots; admin can add them later.
    console.warn('Team seed failed (non-fatal). Continuing without headshots.');
  }
}

// Hand off to the real server.
await import('./server.js');
