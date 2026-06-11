// One-time script: import the real WSM team from the Our Team page.
// Clears placeholder employees, inserts real ones, and downloads headshots.
import { db } from './db.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';
import https from 'https';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const TEAM = [
  { name: 'Peter Larson',      title: 'Senior Director, WinShape Marriage',            photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2025/12/Peter-Larson.png' },
  { name: 'Leonna Bias',       title: 'Executive Administrative Assistant',             photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20230117_WS_LEONNA_BIAS-e1693424439115.jpg' },
  { name: 'David Jauregui',    title: 'Assistant Director, Renewal',                   photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2026/06/David-Jauregui-800x800.jpg' },
  { name: 'Jessica Deagle',    title: 'Program Lead for R&Rs',                         photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2026/04/20230807_WS_JESSICA_DEAGLE-0001-800x800.jpg' },
  { name: 'Allyson Noland',    title: 'Assistant Director, Discipleship',              photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2024/06/image.jpeg' },
  { name: 'Taylor Tibbetts',   title: 'Coordinator, Host Couples',                     photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2024/05/20220830_WSC_HEADSHOTS_TAYLOR_TIBBETTS-scaled.jpg' },
  { name: 'Genee Francis',     title: 'Assistant Director, Content and Programming',   photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2025/01/Genee-Francis.png' },
  { name: 'Ashlyn Sullins',    title: 'Coordinator, Retreats',                         photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2026/04/20230918_WS_ASHLYN_HERRING-1-800x800.jpg' },
  { name: 'Greg Saffles',      title: 'Assistant Director, Strategy and Communications', photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20221012_WINDAY_HEADSHOTS_GREG_SAFFLES.jpg' },
  { name: 'Rob Philo',         title: 'Manager, Marketing',                            photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20230117_WS_ROB_PHILO-e1693424708729.jpg' },
  { name: 'Marlee Arnold',     title: 'Specialist, Content Marketing',                 photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20241210_WS_MARLEE_ARNOLD.jpg' },
  { name: 'Gwen Numbers',      title: 'Team Leader, Customer Experience',              photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2023/09/MicrosoftTeams-image-27.jpg' },
  { name: 'Sarah Grace Smith', title: 'Coordinator, Customer Experience',              photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2025/01/20220830_WSC_HEADSHOTS_SARAH_MOBLEY-scaled.jpg' },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          file.destroy();
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    };
    get(url);
  });
}

function ext(url) {
  const m = url.replace(/\?.*$/, '').match(/\.(\w+)$/);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

// --- wipe placeholder team, insert real roster ---
db.exec('DELETE FROM employees');
const ins = db.prepare('INSERT INTO employees (name, sort_order) VALUES (?, ?)');
TEAM.forEach(({ name }, i) => ins.run(name, i));

console.log(`Inserted ${TEAM.length} team members.`);

// --- download headshots ---
for (const [i, member] of TEAM.entries()) {
  const id = db.prepare('SELECT id FROM employees WHERE name = ?').get(member.name)?.id;
  if (!id) continue;
  const filename = `employee-${id}.${ext(member.photo)}`;
  const dest = join(UPLOAD_DIR, filename);
  process.stdout.write(`  Downloading ${member.name}… `);
  try {
    await download(member.photo, dest);
    db.prepare('UPDATE employees SET photo_path = ? WHERE id = ?').run(`/uploads/${filename}`, id);
    console.log('✓');
  } catch (e) {
    console.log(`✗ (${e.message})`);
  }
}

console.log('\nDone. Real team loaded with headshots.');
