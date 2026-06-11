# WinShape Marriage — Retreat Inventory Portal

A lightweight portal for tracking retreat supplies. Anyone can scan a QR code and
record what they're taking out (no login); admins manage inventory and see the full
history of who took what.

## What's here

| Surface | URL | Who |
|---|---|---|
| **Checkout form** | `/` | Anyone (this is what the QR code opens) |
| **Admin dashboard** | `/admin` | Admins (password-protected) |

- **Checkout form** — pick a retreat (optional filter), choose an item from a searchable
  dropdown that shows each item's **photo** and live stock, set a quantity, pick your name
  from the **team list** (or type one in), add optional notes. Submitting decrements the
  live count.
- **Admin dashboard** — four tabs:
  - **Inventory** — every item grouped by retreat with live, color-coded stock and a photo
    thumbnail. Add, edit, restock, move between retreats, upload a photo, or remove items.
    **Sort** each retreat by sheet order, name, or quantity.
  - **Checkout Log** — searchable record of every checkout (who, what, when, notes) plus
    admin stock adjustments. Export to CSV.
  - **Team** — manage the employee roster that fills the form's name picker (add, edit,
    deactivate, delete).
  - **QR Code** — a printable QR pointing at the checkout form. Post it by the supplies.
- **Live sync** — open forms and the dashboard update in real time (Server-Sent Events)
  as people check things out.

## Run it

```bash
npm install
npm run seed     # loads items from the CSV into data.db (first run only)
npm start        # → http://localhost:4173
```

Admin password defaults to `winshape`. Override it:

```bash
ADMIN_PASSWORD="something-better" npm start
```

Other scripts:

- `npm run reset` — wipe `data.db` and re-seed from the CSV.

## How it's built

- **Backend:** Node + Express + SQLite (`better-sqlite3`) — a single local `data.db`
  file, no external services.
- **Frontend:** plain HTML/CSS/JS (no build step) in `public/`, styled with the WSM
  brand palette and the Calibre fonts in `fonts/`.
- **Real-time:** Server-Sent Events (`/api/events`).
- **Seed:** `seed.js` parses `WSM Retreat Pick List(Warehouse Supply Count) 2.csv`,
  which lays out four retreats side by side (Miscellaneous, Enrichment, Marriage
  Discipleship, R&R).

## Notes / next steps for a real deployment

This is a working prototype. Before putting it in front of staff you'd want to:

- **Harden auth** — the admin login is a single shared password with an in-memory
  session. Move to real accounts (or SSO) and a signed session store.
- **Host it** — deploy to a small server or platform (Render, Fly, a VPS) so the QR
  code points at a stable public URL instead of `localhost`.
- **Backups** — `data.db` holds the source of truth (item photos live in
  `public/uploads/`); schedule a copy of both somewhere safe.
- **Low-stock alerts** — e.g. email the admin when an item drops below a threshold.
