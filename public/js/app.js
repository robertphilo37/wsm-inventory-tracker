// WSM Supply Checkout — public form logic
const $ = (id) => document.getElementById(id);
let items = [];
let employees = [];

let activeCat = '';   // currently selected category filter chip

const els = {
  itemHidden: $('item'),
  itemBtn: $('item-btn'),
  itemBtnLabel: $('item-btn-label'),
  itemPanel: $('item-panel'),
  itemSearch: $('item-search'),
  itemList: $('item-list'),
  preview: $('preview'),
  pvThumb: $('pv-thumb'),
  pvName: $('pv-name'),
  pvMeta: $('pv-meta'),
  qty: $('quantity'),
  personHidden: $('person'),
  personBtn: $('person-btn'),
  personBtnLabel: $('person-btn-label'),
  personBtnThumb: $('person-btn-thumb'),
  personPanel: $('person-panel'),
  personList: $('person-list'),
  personOther: $('person-other'),
  notes: $('notes'),
  form: $('checkout-form'),
  success: $('success'),
  successMsg: $('success-msg'),
  submit: $('submit-btn'),
};

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
function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
}
function thumbHtml(item, big) {
  const cls = big ? 'thumb thumb-lg' : 'thumb';
  return item.image_path
    ? `<span class="${cls}" style="background-image:url('${esc(item.image_path)}')"></span>`
    : `<span class="${cls} thumb-ph">${esc(initials(item.name))}</span>`;
}

async function load() {
  const [itemsRes, catsRes, empRes] = await Promise.all([
    fetch('/api/items').then((r) => r.json()),
    fetch('/api/categories').then((r) => r.json()),
    fetch('/api/employees').then((r) => r.json()),
  ]);
  items = itemsRes;
  employees = empRes;

  // Build category filter chips inside the item dropdown
  const chips = $('cat-chips');
  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = 'cat-chip active';
  allChip.textContent = 'All';
  allChip.dataset.cat = '';
  chips.appendChild(allChip);
  catsRes.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-chip';
    btn.textContent = c;
    btn.dataset.cat = c;
    chips.appendChild(btn);
  });
  chips.addEventListener('click', (e) => {
    const chip = e.target.closest('.cat-chip');
    if (!chip) return;
    activeCat = chip.dataset.cat;
    chips.querySelectorAll('.cat-chip').forEach((b) => b.classList.toggle('active', b.dataset.cat === activeCat));
    renderItemList();
  });

  renderPeople();
  renderItemList();
}

/* ---------------- name picker (custom combobox with headshots) ---------------- */
function empThumbHtml(e, size) {
  const s = size || 32;
  return e.photo_path
    ? `<span class="thumb thumb-round" style="width:${s}px;height:${s}px;background-image:url('${esc(e.photo_path)}');flex:none;"></span>`
    : `<span class="thumb thumb-round thumb-ph" style="width:${s}px;height:${s}px;font-size:${Math.round(s*0.35)}px;flex:none;">${esc(initials(e.name))}</span>`;
}
function renderPeople() {
  let html = employees.map((e) => `
    <div class="combo-item" data-person="${esc(e.name)}" data-photo="${esc(e.photo_path || '')}" role="option">
      ${empThumbHtml(e, 38)}
      <span class="combo-item-text"><span class="combo-item-name">${esc(e.name)}</span></span>
    </div>`).join('');
  html += `<div class="combo-item combo-item-other" data-person="__other__" role="option">
    <span class="thumb thumb-round thumb-ph" style="width:38px;height:38px;font-size:14px;flex:none;">?</span>
    <span class="combo-item-text"><span class="combo-item-name">Someone else…</span></span>
  </div>`;
  els.personList.innerHTML = html;
  els.personList.querySelectorAll('.combo-item').forEach((el) =>
    el.addEventListener('click', () => choosePerson(el.dataset.person, el.dataset.photo || '')));
}
function choosePerson(name, photo) {
  closePersonPanel();
  if (name === '__other__') {
    els.personHidden.value = '';
    els.personBtnLabel.textContent = 'Someone else…';
    els.personBtnThumb.innerHTML = `<span class="thumb thumb-round thumb-ph" style="width:32px;height:32px;font-size:12px;flex:none;">?</span>`;
    els.personBtn.classList.add('has-value');
    els.personOther.style.display = '';
    els.personOther.focus();
  } else {
    els.personHidden.value = name;
    els.personBtnLabel.textContent = name;
    els.personBtnThumb.innerHTML = photo
      ? `<span class="thumb thumb-round" style="width:32px;height:32px;background-image:url('${esc(photo)}');flex:none;"></span>`
      : `<span class="thumb thumb-round thumb-ph" style="width:32px;height:32px;font-size:12px;flex:none;">${esc(initials(name))}</span>`;
    els.personBtn.classList.add('has-value');
    els.personOther.style.display = 'none';
    els.personOther.value = '';
  }
}
function openPersonPanel() { els.personPanel.classList.add('open'); els.personBtn.setAttribute('aria-expanded','true'); }
function closePersonPanel() { els.personPanel.classList.remove('open'); els.personBtn.setAttribute('aria-expanded','false'); }
els.personBtn.addEventListener('click', () => { els.personPanel.classList.contains('open') ? closePersonPanel() : openPersonPanel(); });
document.addEventListener('click', (e) => { if (!$('person-combo').contains(e.target)) closePersonPanel(); });
function personName() {
  if (els.personHidden.value === '' || els.personHidden.value === '__other__') return els.personOther.value.trim();
  return els.personHidden.value;
}

/* ---------------- custom item dropdown ---------------- */
function selectedItem() { return items.find((i) => String(i.id) === els.itemHidden.value); }

function renderItemList() {
  const cat = activeCat;
  const q = els.itemSearch.value.trim().toLowerCase();
  const cats = [...new Set(items.map((i) => i.category))];
  let html = '';
  let shown = 0;
  cats.forEach((c) => {
    if (cat && c !== cat) return;
    let rows = items.filter((i) => i.category === c);
    if (q) rows = rows.filter((i) => i.name.toLowerCase().includes(q));
    if (!rows.length) return;
    html += `<div class="combo-group">${esc(c)}</div>`;
    rows.forEach((i) => {
      shown++;
      const out = i.quantity <= 0;
      const cls = stockClass(i.quantity);
      const stock = out ? 'Out of stock' : `${i.quantity} left`;
      html += `<div class="combo-item ${out ? 'disabled' : ''}" data-id="${i.id}" role="option">
        ${thumbHtml(i)}
        <span class="combo-item-text">
          <span class="combo-item-name">${esc(i.name)}</span>
          <span class="stock ${cls}"><span class="dot"></span>${stock}</span>
        </span>
      </div>`;
    });
  });
  els.itemList.innerHTML = shown ? html : '<div class="combo-empty">No items match.</div>';
  els.itemList.querySelectorAll('.combo-item:not(.disabled)').forEach((el) =>
    el.addEventListener('click', () => chooseItem(Number(el.dataset.id))));
}

function chooseItem(id) {
  els.itemHidden.value = id;
  closePanel();
  updatePreview();
}

function updatePreview() {
  const it = selectedItem();
  if (!it) {
    els.preview.classList.remove('show');
    els.itemBtnLabel.textContent = 'Select an item…';
    els.itemBtn.classList.remove('has-value');
    return;
  }
  els.itemBtnLabel.textContent = it.name;
  els.itemBtn.classList.add('has-value');
  els.preview.classList.add('show');
  els.pvThumb.innerHTML = thumbHtml(it, true);
  els.pvName.textContent = it.name;
  const cls = stockClass(it.quantity);
  const word = it.quantity <= 0 ? 'Out of stock' : `${it.quantity} in stock`;
  els.pvMeta.innerHTML =
    `<span class="stock ${cls}"><span class="dot"></span>${word}</span>` +
    (it.vendor ? ` · ${esc(it.vendor)}` : '') +
    (it.location ? `<div class="pv-location">📍 ${esc(it.location)}</div>` : '');
  els.qty.max = Math.max(1, it.quantity);
}

function openPanel() {
  els.itemPanel.classList.add('open');
  els.itemBtn.setAttribute('aria-expanded', 'true');
  els.itemSearch.value = '';
  renderItemList();
  els.itemSearch.focus();
}
function closePanel() {
  els.itemPanel.classList.remove('open');
  els.itemBtn.setAttribute('aria-expanded', 'false');
}
els.itemBtn.addEventListener('click', () => {
  els.itemPanel.classList.contains('open') ? closePanel() : openPanel();
});
els.itemSearch.addEventListener('input', renderItemList);
document.addEventListener('click', (e) => {
  if (!$('item-combo').contains(e.target)) closePanel();
});

// --- events ---
$('minus').addEventListener('click', () => { els.qty.value = Math.max(1, (parseInt(els.qty.value, 10) || 1) - 1); });
$('plus').addEventListener('click', () => { els.qty.value = (parseInt(els.qty.value, 10) || 0) + 1; });

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const it = selectedItem();
  if (!it) return toast('Please choose an item.', true);
  const qty = parseInt(els.qty.value, 10);
  if (!qty || qty < 1) return toast('Quantity must be at least 1.', true);
  const who = personName();
  if (!who) return toast('Please select or enter your name.', true);

  els.submit.disabled = true;
  els.submit.textContent = 'Submitting…';
  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: it.id, quantity: qty, person_name: who, notes: els.notes.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    els.successMsg.textContent =
      `${qty} × ${it.name} checked out. ${data.item.quantity} now remaining — thanks, ${who.split(' ')[0]}!`;
    els.form.style.display = 'none';
    els.success.classList.add('show');
  } catch (err) {
    toast(err.message, true);
  } finally {
    els.submit.disabled = false;
    els.submit.textContent = 'Check out item';
  }
});

$('another').addEventListener('click', () => {
  els.success.classList.remove('show');
  els.form.style.display = '';
  els.itemHidden.value = '';
  els.qty.value = 1;
  els.notes.value = '';
  updatePreview();
  // keep the name picker filled — same person grabbing multiple things
});

// --- live updates via SSE ---
const es = new EventSource('/api/events');
es.addEventListener('item-updated', (e) => {
  const updated = JSON.parse(e.data);
  const idx = items.findIndex((i) => i.id === updated.id);
  if (idx === -1) items.push(updated); else items[idx] = updated;
  if (els.itemPanel.classList.contains('open')) renderItemList();
  if (selectedItem() && selectedItem().id === updated.id) updatePreview();
});
es.addEventListener('item-removed', (e) => {
  const { id } = JSON.parse(e.data);
  items = items.filter((i) => i.id !== id);
  if (String(id) === els.itemHidden.value) { els.itemHidden.value = ''; updatePreview(); }
  if (els.itemPanel.classList.contains('open')) renderItemList();
});

load();
