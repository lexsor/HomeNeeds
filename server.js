// Family Shopping List — server
// Express + SQLite (better-sqlite3) + Server-Sent Events for real-time sync.

const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'list.db');

// --- database ---------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    quantity   TEXT    NOT NULL DEFAULT '',
    notes      TEXT    NOT NULL DEFAULT '',
    checked    INTEGER NOT NULL DEFAULT 0,
    added_by   TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS favorites (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    notes      TEXT    NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
  -- Case-insensitive unique index so we don't accumulate duplicates like
  -- "Milk" / "milk" / "MILK" when different family members star the same thing.
  CREATE UNIQUE INDEX IF NOT EXISTS favorites_name_nocase
    ON favorites (name COLLATE NOCASE);
`);

const favoriteColumns = db.prepare(`PRAGMA table_info(favorites)`).all();
if (!favoriteColumns.some((column) => column.name === 'quantity')) {
  db.exec(`ALTER TABLE favorites ADD COLUMN quantity TEXT NOT NULL DEFAULT ''`);
}

const stmts = {
  listAll:    db.prepare('SELECT * FROM items ORDER BY checked ASC, created_at ASC'),
  insert:     db.prepare(`INSERT INTO items (name, quantity, notes, added_by, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?)`),
  getById:    db.prepare('SELECT * FROM items WHERE id = ?'),
  update:     db.prepare(`UPDATE items SET name = ?, quantity = ?, notes = ?, updated_at = ? WHERE id = ?`),
  setChecked: db.prepare('UPDATE items SET checked = ?, updated_at = ? WHERE id = ?'),
  remove:     db.prepare('DELETE FROM items WHERE id = ?'),
  clearChecked: db.prepare('DELETE FROM items WHERE checked = 1'),

  // favorites
  favListAll:        db.prepare('SELECT * FROM favorites ORDER BY name COLLATE NOCASE ASC'),
  favInsert:         db.prepare('INSERT INTO favorites (name, quantity, notes, created_at) VALUES (?, ?, ?, ?)'),
  favGetById:        db.prepare('SELECT * FROM favorites WHERE id = ?'),
  favGetByName:      db.prepare('SELECT * FROM favorites WHERE name = ? COLLATE NOCASE'),
  favUpdate:         db.prepare('UPDATE favorites SET quantity = ?, notes = ? WHERE id = ?'),
  favRemoveById:     db.prepare('DELETE FROM favorites WHERE id = ?'),
  favRemoveByName:   db.prepare('DELETE FROM favorites WHERE name = ? COLLATE NOCASE'),
};

function rowToItem(r) {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    notes: r.notes,
    checked: !!r.checked,
    addedBy: r.added_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToFavorite(r) {
  return {
    id: r.id,
    name: r.name,
    quantity: r.quantity || '',
    notes: r.notes,
    createdAt: r.created_at,
  };
}

// --- SSE broadcast ----------------------------------------------------------
const clients = new Set();
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(data); } catch (_) { /* client will be cleaned up */ }
  }
}

// --- app --------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/items', (req, res) => {
  const items = stmts.listAll.all().map(rowToItem);
  res.json({ items });
});

app.post('/api/items', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const quantity = String(req.body?.quantity || '').trim().slice(0, 40);
  const notes    = String(req.body?.notes    || '').trim().slice(0, 200);
  const addedBy  = String(req.body?.addedBy  || '').trim().slice(0, 40);
  const now = Date.now();
  const info = stmts.insert.run(name.slice(0, 80), quantity, notes, addedBy, now, now);
  const item = rowToItem(stmts.getById.get(info.lastInsertRowid));
  broadcast('item:created', item);
  res.status(201).json(item);
});

app.patch('/api/items/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = stmts.getById.get(id);
  if (!row) return res.status(404).json({ error: 'not found' });

  if (typeof req.body?.checked === 'boolean') {
    stmts.setChecked.run(req.body.checked ? 1 : 0, Date.now(), id);
  }
  if (req.body?.name !== undefined || req.body?.quantity !== undefined || req.body?.notes !== undefined) {
    const fresh = stmts.getById.get(id);
    const name     = req.body?.name     !== undefined ? String(req.body.name).trim().slice(0, 80)      : fresh.name;
    const quantity = req.body?.quantity !== undefined ? String(req.body.quantity).trim().slice(0, 40)  : fresh.quantity;
    const notes    = req.body?.notes    !== undefined ? String(req.body.notes).trim().slice(0, 200)    : fresh.notes;
    if (!name) return res.status(400).json({ error: 'name is required' });
    stmts.update.run(name, quantity, notes, Date.now(), id);
  }
  const item = rowToItem(stmts.getById.get(id));
  broadcast('item:updated', item);
  res.json(item);
});

app.delete('/api/items/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = stmts.getById.get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  stmts.remove.run(id);
  broadcast('item:deleted', { id });
  res.status(204).end();
});

app.post('/api/items/clear-checked', (req, res) => {
  const info = stmts.clearChecked.run();
  broadcast('items:cleared-checked', { count: info.changes });
  res.json({ count: info.changes });
});

// --- favorites --------------------------------------------------------------
// Favorites are shared across the family (same model as items) and survive
// across shopping trips. Star an item to save it; tap a favorite to re-add it
// to the active list with its saved notes prefilled.

app.get('/api/favorites', (req, res) => {
  const favorites = stmts.favListAll.all().map(rowToFavorite);
  res.json({ favorites });
});

app.post('/api/favorites', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'name is required' });
  const quantity = String(req.body?.quantity || '').trim().slice(0, 40);
  const notes = String(req.body?.notes || '').trim().slice(0, 200);

  // Idempotent: if a favorite with this name already exists (case-insensitive),
  // update its notes rather than failing on the unique index.
  const existing = stmts.favGetByName.get(name);
  if (existing) {
    if (quantity !== (existing.quantity || '') || notes !== existing.notes) {
      stmts.favUpdate.run(quantity, notes, existing.id);
    }
    const fav = rowToFavorite(stmts.favGetById.get(existing.id));
    broadcast('favorite:created', fav); // re-broadcast so all clients re-render
    return res.status(200).json(fav);
  }

  const info = stmts.favInsert.run(name, quantity, notes, Date.now());
  const fav = rowToFavorite(stmts.favGetById.get(info.lastInsertRowid));
  broadcast('favorite:created', fav);
  res.status(201).json(fav);
});

app.delete('/api/favorites/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = stmts.favGetById.get(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  stmts.favRemoveById.run(id);
  broadcast('favorite:deleted', { id });
  res.status(204).end();
});

// Convenience: unfavorite by name (case-insensitive). Lets the UI un-star
// from the item row without having to know the favorite's id.
app.delete('/api/favorites', (req, res) => {
  const name = String(req.query?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name query param is required' });
  const row = stmts.favGetByName.get(name);
  if (!row) return res.status(204).end();
  stmts.favRemoveById.run(row.id);
  broadcast('favorite:deleted', { id: row.id });
  res.status(204).end();
});

// Server-Sent Events — clients subscribe here for live updates.
app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(': connected\n\n');
  clients.add(res);

  const keepalive = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) { /* ignore */ }
  }, 25000);

  req.on('close', () => {
    clearInterval(keepalive);
    clients.delete(res);
  });
});

app.listen(PORT, () => {
  console.log(`[family-shopping-list] listening on :${PORT}  (db: ${DB_PATH})`);
});
