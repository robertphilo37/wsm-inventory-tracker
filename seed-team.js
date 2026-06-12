// Import the real WSM team — stores headshots as base64 data URLs in the DB.
import { db } from './db.js';
import https from 'https';

const TEAM = [
  { name: 'Peter Larson',      photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2025/12/Peter-Larson.png' },
  { name: 'Leonna Bias',       photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20230117_WS_LEONNA_BIAS-e1693424439115.jpg' },
  { name: 'David Jauregui',    photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2026/06/David-Jauregui-800x800.jpg' },
  { name: 'Jessica Deagle',    photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2026/04/20230807_WS_JESSICA_DEAGLE-0001-800x800.jpg' },
  { name: 'Allyson Noland',    photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2024/06/image.jpeg' },
  { name: 'Taylor Tibbetts',   photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2024/05/20220830_WSC_HEADSHOTS_TAYLOR_TIBBETTS-scaled.jpg' },
  { name: 'Genee Francis',     photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2025/01/Genee-Francis.png' },
  { name: 'Ashlyn Sullins',    photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2026/04/20230918_WS_ASHLYN_HERRING-1-800x800.jpg' },
  { name: 'Greg Saffles',      photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20221012_WINDAY_HEADSHOTS_GREG_SAFFLES.jpg' },
  { name: 'Rob Philo',         photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20230117_WS_ROB_PHILO-e1693424708729.jpg' },
  { name: 'Marlee Arnold',     photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2022/12/20241210_WS_MARLEE_ARNOLD.jpg' },
  { name: 'Gwen Numbers',      photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2023/09/MicrosoftTeams-image-27.jpg' },
  { name: 'Sarah Grace Smith', photo: 'https://marriage.winshape.org/wp-content/uploads/sites/4/2025/01/20220830_WSC_HEADSHOTS_SARAH_MOBLEY-scaled.jpg' },
];

function fetchBuf(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let contentType = 'image/jpeg';
    const get = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(res.headers.location);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        contentType = res.headers['content-type']?.split(';')[0] || 'image/jpeg';
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => resolve({ buf: Buffer.concat(chunks), contentType }));
      }).on('error', reject);
    };
    get(url);
  });
}

// Clear and re-insert the team
const stmts = [{ sql: 'DELETE FROM employees', args: [] }];
TEAM.forEach(({ name }, i) =>
  stmts.push({ sql: 'INSERT INTO employees (name, sort_order) VALUES (?, ?)', args: [name, i] })
);
await db.batch(stmts);
console.log(`Inserted ${TEAM.length} team members.`);

// Download headshots and store as base64 data URLs in the DB
for (const member of TEAM) {
  const row = await db.get('SELECT id FROM employees WHERE name = ?', [member.name]);
  if (!row) continue;
  process.stdout.write(`  Downloading ${member.name}… `);
  try {
    const { buf, contentType } = await fetchBuf(member.photo);
    const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
    await db.run('UPDATE employees SET photo_path = ? WHERE id = ?', [dataUrl, row.id]);
    console.log('✓');
  } catch (e) {
    console.log(`✗ (${e.message})`);
  }
}
console.log('\nDone. Real team loaded with headshots.');
