import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'winshape1984';

app.use(express.json({ limit: '20mb' })); // headroom for base64 image / file uploads
app.use(cookieParser());

app.use('/fonts', express.static(join(__dirname, 'fonts')));
app.get('/WSM_logo.png', (_req, res) => res.sendFile(join(__dirname, 'WSM_logo.png')));
app.use(express.static(join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/*  Auth                                                               */
/* ------------------------------------------------------------------ */
// Express 4 doesn't catch rejections from async handlers — without this a DB
// error takes down the process (and with it every logged-in admin session).
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const sessions = new Set();
function isAdmin(req) { return req.cookies && sessions.has(req.cookies.wsm_admin); }
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Not authorized' });
}

app.post('/api/login', (req, res) => {
  if ((req.body?.password || '') === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    res.cookie('wsm_admin', token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Incorrect password' });
});
app.post('/api/logout', (req, res) => {
  sessions.delete(req.cookies?.wsm_admin);
  res.clearCookie('wsm_admin');
  res.json({ ok: true });
});
app.get('/api/me', (req, res) => res.json({ admin: isAdmin(req) }));

/* ------------------------------------------------------------------ */
/*  Server-Sent Events                                                 */
/* ------------------------------------------------------------------ */
let clients = [];
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(': connected\n\n');
  clients.push(res);
  req.on('close', () => { clients = clients.filter((c) => c !== res); });
});
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((c) => c.write(payload));
}

/* ------------------------------------------------------------------ */
/*  Health / diagnostics                                               */
/* ------------------------------------------------------------------ */
app.get('/api/health', wrap(async (_req, res) => {
  const usingTurso = !!process.env.TURSO_DATABASE_URL;
  const hasToken   = !!process.env.TURSO_AUTH_TOKEN;
  try {
    const { c: items } = await db.get('SELECT COUNT(*) c FROM items');
    const { c: emps  } = await db.get('SELECT COUNT(*) c FROM employees');
    res.json({ ok: true, usingTurso, hasToken, items, employees: emps });
  } catch (e) {
    res.status(500).json({ ok: false, usingTurso, hasToken, error: e.message });
  }
}));

/* ------------------------------------------------------------------ */
/*  Inventory                                                          */
/* ------------------------------------------------------------------ */
const CATEGORY_ORDER = ['Miscellaneous Items', 'Enrichment Retreat', 'Marriage Discipleship', 'R&R Retreat'];
function catRank(c) { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? 99 : i; }

app.get('/api/categories', (_req, res) => res.json(CATEGORY_ORDER));

app.get('/api/items', wrap(async (req, res) => {
  const includeArchived = isAdmin(req) && req.query.all === '1';
  const rows = await db.all(includeArchived
    ? 'SELECT items.*, (SELECT COUNT(*) FROM print_files WHERE item_id = items.id) AS file_count FROM items ORDER BY sort_order'
    : 'SELECT items.*, (SELECT COUNT(*) FROM print_files WHERE item_id = items.id) AS file_count FROM items WHERE archived = 0 ORDER BY sort_order');
  rows.sort((a, b) => catRank(a.category) - catRank(b.category) || a.sort_order - b.sort_order);
  res.json(rows);
}));

app.post('/api/checkout', wrap(async (req, res) => {
  const { item_id, quantity, person_name, notes } = req.body || {};
  const qty = parseInt(quantity, 10);
  const name = (person_name || '').trim();
  if (!item_id || !qty || qty < 1) return res.status(400).json({ error: 'Pick an item and a quantity of at least 1.' });
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });

  const item = await db.get('SELECT * FROM items WHERE id = ? AND archived = 0', [item_id]);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (qty > item.quantity) return res.status(400).json({ error: `Only ${item.quantity} of "${item.name}" left.` });

  await db.batch([
    { sql: 'UPDATE items SET quantity = quantity - ? WHERE id = ?', args: [qty, item_id] },
    { sql: 'INSERT INTO checkouts (item_id, item_name, category, quantity, person_name, notes, kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [item_id, item.name, item.category, qty, name, (notes || '').trim() || null, 'checkout'] },
  ]);

  const updated = await db.get('SELECT * FROM items WHERE id = ?', [item_id]);
  broadcast('item-updated', updated);
  res.json({ ok: true, item: updated });
}));

/* -------- Admin: create/update/delete items -------- */
app.post('/api/items', requireAdmin, wrap(async (req, res) => {
  const { category, name, quantity, vendor, cost_per_unit, note, location, low_stock_threshold } = req.body || {};
  const cat = category?.trim() || 'Miscellaneous Items';
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
  const maxRow = await db.get('SELECT COALESCE(MAX(sort_order), 0) m FROM items WHERE category = ?', [cat]);
  const threshold = low_stock_threshold === '' || low_stock_threshold == null ? null : parseInt(low_stock_threshold, 10);
  const info = await db.run(
    'INSERT INTO items (category, name, quantity, vendor, cost_per_unit, note, location, low_stock_threshold, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [cat, name.trim(), parseInt(quantity, 10) || 0,
     vendor?.trim() || null,
     cost_per_unit === '' || cost_per_unit == null ? null : parseFloat(cost_per_unit),
     note?.trim() || null, location?.trim() || null, threshold, (maxRow.m || 0) + 1]);
  const item = await db.get('SELECT * FROM items WHERE id = ?', [info.lastInsertRowid]);
  broadcast('item-updated', item);
  res.json(item);
}));

app.put('/api/items/:id', requireAdmin, wrap(async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const { category, name, quantity, vendor, cost_per_unit, note, location, low_stock_threshold } = req.body || {};
  const newQty = quantity == null ? item.quantity : parseInt(quantity, 10) || 0;
  const newCat = category ?? item.category;
  const maxRow = newCat !== item.category
    ? await db.get('SELECT COALESCE(MAX(sort_order), 0) m FROM items WHERE category = ?', [newCat])
    : { m: item.sort_order };
  const newOrder = newCat !== item.category ? (maxRow.m || 0) + 1 : item.sort_order;
  const threshold = low_stock_threshold === '' || low_stock_threshold == null ? null : parseInt(low_stock_threshold, 10);

  await db.run(
    'UPDATE items SET category=?, name=?, quantity=?, vendor=?, cost_per_unit=?, note=?, location=?, low_stock_threshold=?, sort_order=? WHERE id=?',
    [newCat, name?.trim() || item.name, newQty,
     vendor?.trim() || null,
     cost_per_unit === '' || cost_per_unit == null ? null : parseFloat(cost_per_unit),
     note?.trim() || null, location?.trim() || null, threshold, newOrder, item.id]);

  if (newQty !== item.quantity) {
    await db.run(
      'INSERT INTO checkouts (item_id, item_name, category, quantity, person_name, notes, kind) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [item.id, name?.trim() || item.name, newCat, newQty - item.quantity, 'Admin',
       `Stock set to ${newQty} (was ${item.quantity})`, 'adjustment']);
  }
  const updated = await db.get('SELECT * FROM items WHERE id = ?', [item.id]);
  broadcast('item-updated', updated);
  res.json(updated);
}));

app.delete('/api/items/:id', requireAdmin, wrap(async (req, res) => {
  await db.run('UPDATE items SET archived = 1 WHERE id = ?', [req.params.id]);
  broadcast('item-removed', { id: Number(req.params.id) });
  res.json({ ok: true });
}));

/* -------- Item images (stored as base64 data URLs in the DB) -------- */
const VALID_IMG = /^data:(image\/(?:png|jpe?g|webp|gif));base64,/;

app.post('/api/items/:id/image', requireAdmin, wrap(async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const { dataUrl } = req.body || {};
  if (!VALID_IMG.test(dataUrl || '')) return res.status(400).json({ error: 'That file type isn\u2019t supported (iPhone HEIC photos need converting). Please use a PNG, JPG, WEBP, or GIF.' });
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (bytes.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 6 MB.' });
  await db.run('UPDATE items SET image_path = ?, has_picture = 1 WHERE id = ?', [dataUrl, item.id]);
  const updated = await db.get('SELECT * FROM items WHERE id = ?', [item.id]);
  broadcast('item-updated', updated);
  res.json(updated);
}));

app.delete('/api/items/:id/image', requireAdmin, wrap(async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  await db.run('UPDATE items SET image_path = NULL, has_picture = 0 WHERE id = ?', [item.id]);
  const updated = await db.get('SELECT * FROM items WHERE id = ?', [item.id]);
  broadcast('item-updated', updated);
  res.json(updated);
}));

/* -------- Team / employees -------- */
app.get('/api/employees', wrap(async (req, res) => {
  const all = isAdmin(req) && req.query.all === '1';
  const rows = await db.all(all
    ? 'SELECT * FROM employees ORDER BY sort_order, name'
    : 'SELECT * FROM employees WHERE active = 1 ORDER BY sort_order, name');
  res.json(rows);
}));

app.post('/api/employees', requireAdmin, wrap(async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const maxRow = await db.get('SELECT COALESCE(MAX(sort_order), 0) m FROM employees');
  const info = await db.run('INSERT INTO employees (name, sort_order) VALUES (?, ?)', [name, (maxRow.m || 0) + 1]);
  res.json(await db.get('SELECT * FROM employees WHERE id = ?', [info.lastInsertRowid]));
}));

app.put('/api/employees/:id', requireAdmin, wrap(async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Not found.' });
  const name = req.body?.name != null ? (req.body.name || '').trim() : emp.name;
  const active = req.body?.active != null ? (req.body.active ? 1 : 0) : emp.active;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  await db.run('UPDATE employees SET name = ?, active = ? WHERE id = ?', [name, active, emp.id]);
  res.json(await db.get('SELECT * FROM employees WHERE id = ?', [emp.id]));
}));

app.delete('/api/employees/:id', requireAdmin, wrap(async (req, res) => {
  await db.run('DELETE FROM employees WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/employees/:id/photo', requireAdmin, wrap(async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Not found.' });
  const { dataUrl } = req.body || {};
  if (!VALID_IMG.test(dataUrl || '')) return res.status(400).json({ error: 'Please upload a PNG, JPG, or WEBP image.' });
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (bytes.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 6 MB.' });
  await db.run('UPDATE employees SET photo_path = ? WHERE id = ?', [dataUrl, emp.id]);
  res.json(await db.get('SELECT * FROM employees WHERE id = ?', [emp.id]));
}));

app.delete('/api/employees/:id/photo', requireAdmin, wrap(async (req, res) => {
  const emp = await db.get('SELECT * FROM employees WHERE id = ?', [req.params.id]);
  if (!emp) return res.status(404).json({ error: 'Not found.' });
  await db.run('UPDATE employees SET photo_path = NULL WHERE id = ?', [emp.id]);
  res.json(await db.get('SELECT * FROM employees WHERE id = ?', [emp.id]));
}));

/* -------- Checkout history -------- */
app.get('/api/history', requireAdmin, wrap(async (_req, res) => {
  const rows = await db.all('SELECT * FROM checkouts ORDER BY datetime(created_at) DESC, id DESC LIMIT 500');
  res.json(rows);
}));

app.delete('/api/history/:id', requireAdmin, wrap(async (req, res) => {
  const row = await db.get('SELECT id FROM checkouts WHERE id = ?', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Log entry not found.' });
  await db.run('DELETE FROM checkouts WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

/* -------- Print files -------- */
// List files for an item (metadata only — no blob returned here)
app.get('/api/items/:id/files', requireAdmin, wrap(async (req, res) => {
  const files = await db.all(
    'SELECT id, item_id, filename, mime_type, size_bytes, uploaded_at FROM print_files WHERE item_id = ? ORDER BY uploaded_at',
    [req.params.id]
  );
  res.json(files);
}));

// Upload a file (base64 data URL)
app.post('/api/items/:id/files', requireAdmin, wrap(async (req, res) => {
  const item = await db.get('SELECT id FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const { filename, dataUrl } = req.body || {};
  if (!filename || !dataUrl) return res.status(400).json({ error: 'filename and dataUrl are required.' });
  const match = dataUrl.match(/^data:([^;]+);base64,/);
  if (!match) return res.status(400).json({ error: 'Invalid data URL.' });
  const mimeType = match[1];
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  if (bytes.length > 15 * 1024 * 1024) return res.status(400).json({ error: 'File must be under 15 MB.' });
  const info = await db.run(
    'INSERT INTO print_files (item_id, filename, mime_type, data, size_bytes) VALUES (?, ?, ?, ?, ?)',
    [item.id, filename, mimeType, dataUrl, bytes.length]
  );
  res.json({ id: info.lastInsertRowid, item_id: item.id, filename, mime_type: mimeType, size_bytes: bytes.length });
}));

// Serve / download a file  (?dl=1 forces attachment, otherwise inline for browser preview)
app.get('/api/files/:id', requireAdmin, wrap(async (req, res) => {
  const file = await db.get('SELECT * FROM print_files WHERE id = ?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  const buf = Buffer.from(file.data.split(',')[1], 'base64');
  const disposition = req.query.dl === '1' ? 'attachment' : 'inline';
  res.set({
    'Content-Type': file.mime_type,
    'Content-Disposition': `${disposition}; filename="${encodeURIComponent(file.filename)}"`,
    'Content-Length': buf.length,
  });
  res.send(buf);
}));

// Delete a file
app.delete('/api/files/:id', requireAdmin, wrap(async (req, res) => {
  const file = await db.get('SELECT id FROM print_files WHERE id = ?', [req.params.id]);
  if (!file) return res.status(404).json({ error: 'File not found.' });
  await db.run('DELETE FROM print_files WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

/* -------- QR code -------- */
app.get('/api/qr', requireAdmin, wrap(async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const url = req.query.url || `${base}/`;
  const dataUrl = await QRCode.toDataURL(url, { width: 640, margin: 1, color: { dark: '#3D4A57', light: '#ffffff' } });
  res.json({ url, dataUrl });
}));

app.get('/admin', (_req, res) => res.sendFile(join(__dirname, 'public', 'admin.html')));

/* ------------------------------------------------------------------ */
/*  Errors — always JSON for /api so the client can report them        */
/* ------------------------------------------------------------------ */
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, err);
  if (res.headersSent) return;
  // body-parser flags an over-large JSON body this way
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'That upload is too large. Please use a smaller image.' });
  }
  res.status(500).json({ error: 'Something went wrong saving that. Please try again.' });
});

app.listen(PORT, () => {
  console.log(`WSM Inventory → http://localhost:${PORT}`);
  console.log(`Admin         → http://localhost:${PORT}/admin   (password: ${ADMIN_PASSWORD})`);
});
