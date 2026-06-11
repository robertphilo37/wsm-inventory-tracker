import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import QRCode from 'qrcode';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { db } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4173;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'winshape1984';

const UPLOAD_DIR = join(__dirname, 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

app.use(express.json({ limit: '8mb' })); // headroom for base64 image uploads
app.use(cookieParser());

// Serve fonts + logo from the project root so the existing assets are reused.
app.use('/fonts', express.static(join(__dirname, 'fonts')));
app.get('/WSM_logo.png', (_req, res) => res.sendFile(join(__dirname, 'WSM_logo.png')));
app.use(express.static(join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/*  Auth (lightweight token — prototype-grade)                         */
/* ------------------------------------------------------------------ */
const sessions = new Set();
function isAdmin(req) {
  return req.cookies && sessions.has(req.cookies.wsm_admin);
}
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
/*  Server-Sent Events — live inventory sync                           */
/* ------------------------------------------------------------------ */
let clients = [];
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(': connected\n\n');
  const client = res;
  clients.push(client);
  req.on('close', () => { clients = clients.filter((c) => c !== client); });
});
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach((c) => c.write(payload));
}

/* ------------------------------------------------------------------ */
/*  Inventory API                                                      */
/* ------------------------------------------------------------------ */
const CATEGORY_ORDER = ['Miscellaneous Items', 'Enrichment Retreat', 'Marriage Discipleship', 'R&R Retreat'];
function catRank(c) { const i = CATEGORY_ORDER.indexOf(c); return i === -1 ? 99 : i; }

app.get('/api/items', (req, res) => {
  const includeArchived = isAdmin(req) && req.query.all === '1';
  const rows = db.prepare(
    `SELECT * FROM items ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY sort_order`
  ).all();
  rows.sort((a, b) => catRank(a.category) - catRank(b.category) || a.sort_order - b.sort_order);
  res.json(rows);
});

app.get('/api/categories', (_req, res) => res.json(CATEGORY_ORDER));

// Public checkout — decrements quantity and records who took what.
app.post('/api/checkout', (req, res) => {
  const { item_id, quantity, person_name, notes } = req.body || {};
  const qty = parseInt(quantity, 10);
  const name = (person_name || '').trim();
  if (!item_id || !qty || qty < 1) return res.status(400).json({ error: 'Pick an item and a quantity of at least 1.' });
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });

  const item = db.prepare('SELECT * FROM items WHERE id = ? AND archived = 0').get(item_id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (qty > item.quantity) return res.status(400).json({ error: `Only ${item.quantity} of "${item.name}" left.` });

  const tx = db.transaction(() => {
    db.prepare('UPDATE items SET quantity = quantity - ? WHERE id = ?').run(qty, item_id);
    db.prepare(
      `INSERT INTO checkouts (item_id, item_name, category, quantity, person_name, notes, kind)
       VALUES (?, ?, ?, ?, ?, ?, 'checkout')`
    ).run(item_id, item.name, item.category, qty, name, (notes || '').trim() || null);
  });
  tx();

  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(item_id);
  broadcast('item-updated', updated);
  res.json({ ok: true, item: updated });
});

/* -------- Admin-only item management -------- */
app.post('/api/items', requireAdmin, (req, res) => {
  const { category, name, quantity, vendor, cost_per_unit, note } = req.body || {};
  if (!name?.trim() || !category) return res.status(400).json({ error: 'Name and category are required.' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM items WHERE category = ?').get(category).m;
  const info = db.prepare(
    `INSERT INTO items (category, name, quantity, vendor, cost_per_unit, note, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(category, name.trim(), parseInt(quantity, 10) || 0, vendor?.trim() || null,
        cost_per_unit === '' || cost_per_unit == null ? null : parseFloat(cost_per_unit),
        note?.trim() || null, maxOrder + 1);
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);
  broadcast('item-updated', item);
  res.json(item);
});

app.put('/api/items/:id', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const { category, name, quantity, vendor, cost_per_unit, note } = req.body || {};
  const newQty = quantity == null ? item.quantity : parseInt(quantity, 10) || 0;
  const newCat = category ?? item.category;
  // When an item moves to a different retreat, drop it at the end of that list.
  const newOrder = newCat !== item.category
    ? db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM items WHERE category = ?').get(newCat).m + 1
    : item.sort_order;
  db.prepare(
    `UPDATE items SET category=?, name=?, quantity=?, vendor=?, cost_per_unit=?, note=?, sort_order=? WHERE id=?`
  ).run(newCat, name?.trim() || item.name, newQty,
        vendor?.trim() || null,
        cost_per_unit === '' || cost_per_unit == null ? null : parseFloat(cost_per_unit),
        note?.trim() || null, newOrder, item.id);
  // Log manual stock corrections so the history stays honest.
  if (newQty !== item.quantity) {
    db.prepare(
      `INSERT INTO checkouts (item_id, item_name, category, quantity, person_name, notes, kind)
       VALUES (?, ?, ?, ?, 'Admin', ?, 'adjustment')`
    ).run(item.id, name?.trim() || item.name, category ?? item.category,
          newQty - item.quantity, `Stock set to ${newQty} (was ${item.quantity})`);
  }
  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(item.id);
  broadcast('item-updated', updated);
  res.json(updated);
});

app.delete('/api/items/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE items SET archived = 1 WHERE id = ?').run(req.params.id);
  broadcast('item-removed', { id: Number(req.params.id) });
  res.json({ ok: true });
});

/* -------- Item image upload (admin) -------- */
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
app.post('/api/items/:id/image', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  const { dataUrl } = req.body || {};
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m || !MIME_EXT[m[1]]) return res.status(400).json({ error: 'Please upload a PNG, JPG, WEBP, or GIF image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 6 MB.' });

  // Clear any prior file so we don't orphan it on extension change.
  if (item.image_path) { try { fs.unlinkSync(join(__dirname, 'public', item.image_path)); } catch {} }
  const rel = `/uploads/item-${item.id}.${MIME_EXT[m[1]]}`;
  fs.writeFileSync(join(__dirname, 'public', rel), buf);
  db.prepare('UPDATE items SET image_path = ?, has_picture = 1 WHERE id = ?').run(rel, item.id);
  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(item.id);
  broadcast('item-updated', updated);
  res.json(updated);
});

app.delete('/api/items/:id/image', requireAdmin, (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  if (item.image_path) { try { fs.unlinkSync(join(__dirname, 'public', item.image_path)); } catch {} }
  db.prepare('UPDATE items SET image_path = NULL WHERE id = ?').run(item.id);
  const updated = db.prepare('SELECT * FROM items WHERE id = ?').get(item.id);
  broadcast('item-updated', updated);
  res.json(updated);
});

/* -------- Team / employees -------- */
// Public list (the checkout form's name picker needs it); only active members.
app.get('/api/employees', (req, res) => {
  const all = isAdmin(req) && req.query.all === '1';
  const rows = db.prepare(
    `SELECT * FROM employees ${all ? '' : 'WHERE active = 1'} ORDER BY sort_order, name COLLATE NOCASE`
  ).all();
  res.json(rows);
});
app.post('/api/employees', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) m FROM employees').get().m;
  const info = db.prepare('INSERT INTO employees (name, sort_order) VALUES (?, ?)').run(name, maxOrder + 1);
  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(info.lastInsertRowid));
});
app.put('/api/employees/:id', requireAdmin, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found.' });
  const name = req.body?.name != null ? (req.body.name || '').trim() : emp.name;
  const active = req.body?.active != null ? (req.body.active ? 1 : 0) : emp.active;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  db.prepare('UPDATE employees SET name = ?, active = ? WHERE id = ?').run(name, active, emp.id);
  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(emp.id));
});
app.delete('/api/employees/:id', requireAdmin, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (emp?.photo_path) { try { fs.unlinkSync(join(__dirname, 'public', emp.photo_path)); } catch {} }
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/employees/:id/photo', requireAdmin, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found.' });
  const { dataUrl } = req.body || {};
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl || '');
  if (!m || !MIME_EXT[m[1]]) return res.status(400).json({ error: 'Please upload a PNG, JPG, or WEBP image.' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Image must be under 6 MB.' });
  if (emp.photo_path) { try { fs.unlinkSync(join(__dirname, 'public', emp.photo_path)); } catch {} }
  const rel = `/uploads/employee-${emp.id}.${MIME_EXT[m[1]]}`;
  fs.writeFileSync(join(__dirname, 'public', rel), buf);
  db.prepare('UPDATE employees SET photo_path = ? WHERE id = ?').run(rel, emp.id);
  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(emp.id));
});
app.delete('/api/employees/:id/photo', requireAdmin, (req, res) => {
  const emp = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!emp) return res.status(404).json({ error: 'Not found.' });
  if (emp.photo_path) { try { fs.unlinkSync(join(__dirname, 'public', emp.photo_path)); } catch {} }
  db.prepare('UPDATE employees SET photo_path = NULL WHERE id = ?').run(emp.id);
  res.json(db.prepare('SELECT * FROM employees WHERE id = ?').get(emp.id));
});

/* -------- Checkout history (admin) -------- */
app.get('/api/history', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM checkouts ORDER BY datetime(created_at) DESC, id DESC LIMIT 500').all();
  res.json(rows);
});

app.delete('/api/history/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT id FROM checkouts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Log entry not found.' });
  db.prepare('DELETE FROM checkouts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* -------- QR code for the public form -------- */
app.get('/api/qr', requireAdmin, async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const url = req.query.url || `${base}/`;
  const dataUrl = await QRCode.toDataURL(url, { width: 640, margin: 1, color: { dark: '#3D4A57', light: '#ffffff' } });
  res.json({ url, dataUrl });
});

/* -------- Page routes -------- */
app.get('/admin', (_req, res) => res.sendFile(join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => {
  console.log(`WSM Inventory running → http://localhost:${PORT}`);
  console.log(`Admin dashboard      → http://localhost:${PORT}/admin   (password: ${ADMIN_PASSWORD})`);
});
