// WSM Inventory Admin
const $ = (id) => document.getElementById(id);
let items = [];
let categories = [];
let history = [];
let employees = [];
let pendingImage = null;       // { dataUrl } chosen but not yet uploaded (new items)
let clearImage = false;        // remove existing image on save
let pendingEmpPhoto = null;    // { dataUrl } for employee modal
let clearEmpPhoto = false;

function toast(msg, isErr) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(t._t);
  t._t = setTimeout(() => (t.className = 'toast'), 3200);
}
function esc(s) {
  return (s ?? '').toString().replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function stockClass(q) { return q <= 0 ? 'out' : q <= 5 ? 'low' : ''; }
function money(n) { return n == null ? '' : '$' + Number(n).toFixed(2); }
function initials(name) { return name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase(); }
function thumbHtml(i) {
  return i.image_path
    ? `<span class="thumb" style="background-image:url('${esc(i.image_path)}')"></span>`
    : `<span class="thumb thumb-ph">${esc(initials(i.name))}</span>`;
}
function empThumbHtml(e, lg) {
  const cls = lg ? 'thumb thumb-round thumb-lg' : 'thumb thumb-round';
  return e.photo_path
    ? `<span class="${cls}" style="background-image:url('${esc(e.photo_path)}')"></span>`
    : `<span class="${cls} thumb-ph">${esc(initials(e.name))}</span>`;
}

/* ---------------- auth ---------------- */
async function checkAuth() {
  const { admin } = await fetch('/api/me').then((r) => r.json());
  $('login').style.display = admin ? 'none' : 'block';
  $('app').style.display = admin ? 'block' : 'none';
  if (admin) init();
}
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: $('password').value }),
  });
  if (res.ok) checkAuth();
  else toast('Incorrect password.', true);
});
$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.reload();
});

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const name = tab.dataset.tab;
    ['inventory', 'history', 'team', 'qr'].forEach((t) => {
      $('tab-' + t).style.display = t === name ? '' : 'none';
    });
    if (name === 'history') loadHistory();
    if (name === 'team') loadTeam();
    if (name === 'qr') loadQR();
  });
});

/* ---------------- init / data ---------------- */
async function init() {
  [categories, employees] = await Promise.all([
    fetch('/api/categories').then((r) => r.json()),
    fetch('/api/employees?all=1').then((r) => r.json()),
  ]);
  const catFilter = $('cat-filter');
  const fCat = $('f-category');
  categories.forEach((c) => {
    catFilter.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`);
    fCat.insertAdjacentHTML('beforeend', `<option value="${esc(c)}">${esc(c)}</option>`);
  });
  await loadItems();
  connectSSE();
}

async function loadItems() {
  items = await fetch('/api/items').then((r) => r.json());
  renderInventory();
}

function sortRows(rows) {
  const mode = $('sort').value;
  const by = {
    'name-asc': (a, b) => a.name.localeCompare(b.name),
    'name-desc': (a, b) => b.name.localeCompare(a.name),
    'qty-asc': (a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name),
    'qty-desc': (a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name),
    'default': (a, b) => a.sort_order - b.sort_order,
  }[mode];
  return [...rows].sort(by);
}

function renderInventory() {
  const q = $('search').value.trim().toLowerCase();
  const catSel = $('cat-filter').value;
  const container = $('inventory-list');
  container.innerHTML = '';

  let shown = 0;
  categories.forEach((cat) => {
    if (catSel && cat !== catSel) return;
    let rows = items.filter((i) => i.category === cat);
    if (q) rows = rows.filter((i) =>
      i.name.toLowerCase().includes(q) || (i.vendor || '').toLowerCase().includes(q));
    if (!rows.length) return;
    rows = sortRows(rows);
    shown += rows.length;

    const totalUnits = rows.reduce((s, i) => s + i.quantity, 0);
    const body = rows.map((i) => {
      const cls = stockClass(i.quantity);
      return `<tr>
        <td class="thumb-cell">${thumbHtml(i)}</td>
        <td>${esc(i.name)}
          ${i.note ? `<div class="muted" style="font-size:13px;">${esc(i.note)}</div>` : ''}</td>
        <td class="num"><span class="qtypill ${cls}">${i.quantity}</span></td>
        <td class="hide-sm muted">${esc(i.vendor || '')}</td>
        <td class="num hide-sm muted">${money(i.cost_per_unit)}</td>
        <td><div class="row-actions">
          <button class="btn btn-ghost btn-sm" data-edit="${i.id}">Edit</button>
        </div></td>
      </tr>`;
    }).join('');

    container.insertAdjacentHTML('beforeend', `
      <div class="cat-head"><h3>${esc(cat)}</h3>
        <span class="count">${rows.length} items · ${totalUnits} units</span></div>
      <div class="cat-bar"></div>
      <div class="card" style="padding:6px 6px;">
        <table>
          <thead><tr>
            <th class="thumb-cell"></th>
            <th>Item</th><th class="num">Qty</th>
            <th class="hide-sm">Vendor</th><th class="num hide-sm">Cost</th><th></th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`);
  });

  if (!shown) container.innerHTML = '<div class="empty">No items match your search.</div>';
  container.querySelectorAll('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => openModal(Number(b.dataset.edit))));
}
$('search').addEventListener('input', renderInventory);
$('cat-filter').addEventListener('change', renderInventory);
$('sort').addEventListener('change', renderInventory);

/* ---------------- item modal ---------------- */
const modal = $('item-modal');
function setImgPreview(src) {
  const el = $('f-img-preview');
  if (src) {
    el.style.backgroundImage = `url('${src}')`;
    el.classList.add('has-img');
    el.textContent = '';
    $('f-img-remove').style.display = '';
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('has-img');
    el.textContent = 'No photo';
    $('f-img-remove').style.display = 'none';
  }
}
function openModal(id) {
  const it = id ? items.find((i) => i.id === id) : null;
  pendingImage = null; clearImage = false;
  $('f-img-input').value = '';
  $('modal-title').textContent = it ? 'Edit item' : 'Add item';
  $('f-id').value = it ? it.id : '';
  $('f-name').value = it ? it.name : '';
  $('f-category').value = it ? it.category : categories[0];
  $('f-quantity').value = it ? it.quantity : 0;
  $('f-vendor').value = it ? (it.vendor || '') : '';
  $('f-cost').value = it && it.cost_per_unit != null ? it.cost_per_unit : '';
  $('f-note').value = it ? (it.note || '') : '';
  $('modal-delete').style.display = it ? '' : 'none';
  setImgPreview(it && it.image_path ? it.image_path : '');
  modal.classList.add('show');
}
function closeModal() { modal.classList.remove('show'); }
$('add-item').addEventListener('click', () => openModal(null));
$('modal-close').addEventListener('click', closeModal);
$('modal-cancel').addEventListener('click', closeModal);
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

// image picking
$('f-img-pick').addEventListener('click', () => $('f-img-input').click());
$('f-img-input').addEventListener('change', () => {
  const file = $('f-img-input').files[0];
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) return toast('Image must be under 6 MB.', true);
  const reader = new FileReader();
  reader.onload = () => { pendingImage = { dataUrl: reader.result }; clearImage = false; setImgPreview(reader.result); };
  reader.readAsDataURL(file);
});
$('f-img-remove').addEventListener('click', () => {
  pendingImage = null; clearImage = true; $('f-img-input').value = '';
  setImgPreview('');
});

$('modal-save').addEventListener('click', async () => {
  const id = $('f-id').value;
  const payload = {
    name: $('f-name').value, category: $('f-category').value,
    quantity: $('f-quantity').value, vendor: $('f-vendor').value,
    cost_per_unit: $('f-cost').value, note: $('f-note').value,
  };
  if (!payload.name.trim()) return toast('Name is required.', true);
  const res = await fetch(id ? `/api/items/${id}` : '/api/items', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const e = await res.json(); return toast(e.error || 'Save failed.', true); }
  const saved = await res.json();

  // image side-effects
  if (pendingImage) {
    const ir = await fetch(`/api/items/${saved.id}/image`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingImage),
    });
    if (!ir.ok) { const e = await ir.json(); toast(e.error || 'Image upload failed.', true); }
  } else if (clearImage && id) {
    await fetch(`/api/items/${saved.id}/image`, { method: 'DELETE' });
  }

  closeModal();
  await loadItems();
  toast(id ? 'Item updated.' : 'Item added.');
});

$('modal-delete').addEventListener('click', async () => {
  const id = $('f-id').value;
  if (!confirm('Remove this item from the inventory? It will no longer appear on the checkout form.')) return;
  const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
  if (!res.ok) return toast('Delete failed.', true);
  closeModal();
  await loadItems();
  toast('Item removed.');
});

/* ---------------- team ---------------- */
async function loadTeam() {
  employees = await fetch('/api/employees?all=1').then((r) => r.json());
  renderTeam();
}
function renderTeam() {
  const c = $('team-list');
  if (!employees.length) { c.innerHTML = '<div class="empty">No team members yet.</div>'; return; }
  c.innerHTML = `<table><tbody>${employees.map((e) => `
    <tr>
      <td class="thumb-cell">${empThumbHtml(e)}</td>
      <td><span class="emp-name">${esc(e.name)}</span> ${e.active ? '' : '<span class="pic-badge">INACTIVE</span>'}</td>
      <td><div class="row-actions">
        <button class="btn btn-ghost btn-sm" data-emp="${e.id}">Edit</button>
      </div></td>
    </tr>`).join('')}</tbody></table>`;
  c.querySelectorAll('[data-emp]').forEach((b) =>
    b.addEventListener('click', () => openEmp(Number(b.dataset.emp))));
}
const empModal = $('emp-modal');
function setEmpImgPreview(src) {
  const el = $('e-img-preview');
  if (src) {
    el.style.backgroundImage = `url('${src}')`;
    el.classList.add('has-img');
    el.textContent = '';
    $('e-img-remove').style.display = '';
  } else {
    el.style.backgroundImage = '';
    el.classList.remove('has-img');
    el.textContent = 'No photo';
    $('e-img-remove').style.display = 'none';
  }
}
function openEmp(id) {
  const e = id ? employees.find((x) => x.id === id) : null;
  pendingEmpPhoto = null; clearEmpPhoto = false;
  $('e-img-input').value = '';
  $('emp-title').textContent = e ? 'Edit member' : 'Add member';
  $('e-id').value = e ? e.id : '';
  $('e-name').value = e ? e.name : '';
  $('e-active').checked = e ? !!e.active : true;
  $('e-active-row').style.display = e ? '' : 'none';
  $('emp-delete').style.display = e ? '' : 'none';
  setEmpImgPreview(e?.photo_path || '');
  empModal.classList.add('show');
}

$('e-img-pick').addEventListener('click', () => $('e-img-input').click());
$('e-img-input').addEventListener('change', () => {
  const file = $('e-img-input').files[0];
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) return toast('Image must be under 6 MB.', true);
  const reader = new FileReader();
  reader.onload = () => { pendingEmpPhoto = { dataUrl: reader.result }; clearEmpPhoto = false; setEmpImgPreview(reader.result); };
  reader.readAsDataURL(file);
});
$('e-img-remove').addEventListener('click', () => {
  pendingEmpPhoto = null; clearEmpPhoto = true; $('e-img-input').value = '';
  setEmpImgPreview('');
});
$('add-emp').addEventListener('click', () => openEmp(null));
$('emp-close').addEventListener('click', () => empModal.classList.remove('show'));
$('emp-cancel').addEventListener('click', () => empModal.classList.remove('show'));
empModal.addEventListener('click', (e) => { if (e.target === empModal) empModal.classList.remove('show'); });
$('emp-save').addEventListener('click', async () => {
  const id = $('e-id').value;
  const payload = { name: $('e-name').value, active: $('e-active').checked };
  if (!payload.name.trim()) return toast('Name is required.', true);
  const res = await fetch(id ? `/api/employees/${id}` : '/api/employees', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) { const e = await res.json(); return toast(e.error || 'Save failed.', true); }
  const saved = await res.json();

  if (pendingEmpPhoto) {
    await fetch(`/api/employees/${saved.id}/photo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pendingEmpPhoto),
    });
  } else if (clearEmpPhoto && id) {
    await fetch(`/api/employees/${saved.id}/photo`, { method: 'DELETE' });
  }

  empModal.classList.remove('show');
  await loadTeam();
  toast(id ? 'Member updated.' : 'Member added.');
});
$('emp-delete').addEventListener('click', async () => {
  const id = $('e-id').value;
  if (!confirm('Delete this team member? Past checkouts they made stay in the log.')) return;
  await fetch(`/api/employees/${id}`, { method: 'DELETE' });
  empModal.classList.remove('show');
  await loadTeam();
  toast('Member deleted.');
});

/* ---------------- history ---------------- */
async function loadHistory() {
  history = await fetch('/api/history').then((r) => r.json());
  renderHistory();
}
function renderHistory() {
  const q = $('history-search').value.trim().toLowerCase();
  let rows = history;
  if (q) rows = rows.filter((h) =>
    [h.person_name, h.item_name, h.category, h.notes].some((v) => (v || '').toLowerCase().includes(q)));
  const container = $('history-list');
  if (!rows.length) { container.innerHTML = '<div class="empty">No activity yet.</div>'; return; }
  container.innerHTML = `<table>
    <thead><tr>
      <th>When</th><th>Person</th><th>Item</th>
      <th class="num">Qty</th><th class="hide-sm">Retreat</th>
    </tr></thead><tbody>${rows.map((h) => {
      const when = new Date(h.created_at.replace(' ', 'T') + 'Z');
      const isAdj = h.kind === 'adjustment';
      const qtyTxt = isAdj ? (h.quantity > 0 ? `+${h.quantity}` : h.quantity) : h.quantity;
      const emp = employees.find((e) => e.name === h.person_name);
      const avatar = emp?.photo_path
        ? `<span class="thumb thumb-round" style="width:30px;height:30px;background-image:url('${esc(emp.photo_path)}');flex:none;display:inline-block;vertical-align:middle;margin-right:7px;"></span>`
        : '';
      return `<tr class="log-row" data-log="${h.id}" style="cursor:pointer;">
        <td class="muted" style="white-space:nowrap;">${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</td>
        <td>${avatar}${esc(h.person_name)}${isAdj ? ' <span class="pic-badge">ADMIN</span>' : ''}</td>
        <td>${esc(h.item_name)}</td>
        <td class="num">${qtyTxt}</td>
        <td class="hide-sm muted">${esc(h.category)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
  container.querySelectorAll('.log-row').forEach((row) =>
    row.addEventListener('click', () => openLogDetail(Number(row.dataset.log))));
}
$('history-search').addEventListener('input', renderHistory);

/* ---------------- log detail modal ---------------- */
const logModal = $('log-modal');
let activeLogId = null;
function openLogDetail(id) {
  const h = history.find((x) => x.id === id);
  if (!h) return;
  activeLogId = id;
  const when = new Date(h.created_at.replace(' ', 'T') + 'Z');
  const isAdj = h.kind === 'adjustment';
  const emp = employees.find((e) => e.name === h.person_name);
  const item = items.find((i) => i.name === h.item_name);

  // Hero: person photo + item photo side by side
  const personThumb = emp?.photo_path
    ? `<span class="thumb thumb-round thumb-hero" style="background-image:url('${esc(emp.photo_path)}')"></span>`
    : `<span class="thumb thumb-round thumb-ph thumb-hero">${esc(initials(h.person_name))}</span>`;
  const itemThumb = item?.image_path
    ? `<span class="thumb thumb-hero" style="background-image:url('${esc(item.image_path)}')"></span>`
    : `<span class="thumb thumb-ph thumb-hero">${esc(initials(h.item_name))}</span>`;

  $('log-hero').innerHTML = `
    <div class="log-hero-row">
      <div class="log-hero-person">
        ${personThumb}
        <span class="log-hero-label">${esc(h.person_name)}</span>
      </div>
      <div class="log-hero-arrow">→</div>
      <div class="log-hero-item">
        ${itemThumb}
        <span class="log-hero-label">${esc(h.item_name)}</span>
      </div>
    </div>`;

  const qtyDisplay = isAdj
    ? (h.quantity > 0 ? `+${h.quantity} (stock adjustment)` : `${h.quantity} (stock adjustment)`)
    : `${h.quantity}`;

  $('log-dl').innerHTML = `
    <dt>When</dt><dd>${when.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })} at ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</dd>
    <dt>Retreat</dt><dd>${esc(h.category)}</dd>
    <dt>Quantity</dt><dd>${qtyDisplay}</dd>
    ${h.notes ? `<dt>Notes</dt><dd>${esc(h.notes)}</dd>` : ''}
    <dt>Type</dt><dd>${isAdj ? 'Admin adjustment' : 'Checkout'}</dd>`;

  logModal.classList.add('show');
}
function closeLogModal() { logModal.classList.remove('show'); activeLogId = null; }
$('log-close').addEventListener('click', closeLogModal);
$('log-dismiss').addEventListener('click', closeLogModal);
logModal.addEventListener('click', (e) => { if (e.target === logModal) closeLogModal(); });
$('log-delete').addEventListener('click', async () => {
  if (!activeLogId) return;
  if (!confirm('Delete this log entry? This only removes the record — it does not restore inventory.')) return;
  const res = await fetch(`/api/history/${activeLogId}`, { method: 'DELETE' });
  if (!res.ok) return toast('Delete failed.', true);
  history = history.filter((h) => h.id !== activeLogId);
  closeLogModal();
  renderHistory();
  toast('Log entry deleted.');
});

$('export-csv').addEventListener('click', () => {
  const head = ['When', 'Person', 'Item', 'Quantity', 'Retreat', 'Type', 'Notes'];
  const lines = [head.join(',')].concat(history.map((h) =>
    [h.created_at, h.person_name, h.item_name, h.quantity, h.category, h.kind, h.notes || '']
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wsm-checkout-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
});

/* ---------------- QR ---------------- */
async function loadQR() {
  const { url, dataUrl } = await fetch('/api/qr').then((r) => r.json());
  $('qr-img').src = dataUrl;
  $('qr-url').textContent = url;
}
$('print-qr').addEventListener('click', () => window.print());

/* ---------------- live updates ---------------- */
function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('item-updated', (e) => {
    const u = JSON.parse(e.data);
    const idx = items.findIndex((i) => i.id === u.id);
    if (idx === -1) items.push(u); else items[idx] = u;
    renderInventory();
  });
  es.addEventListener('item-removed', (e) => {
    const { id } = JSON.parse(e.data);
    items = items.filter((i) => i.id !== id);
    renderInventory();
  });
}

checkAuth();
