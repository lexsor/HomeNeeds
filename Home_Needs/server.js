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
`);

const stmts = {
  listAll:    db.prepare('SELECT * FROM items ORDER BY checked ASC, created_at ASC'),
  insert:     db.prepare(`INSERT INTO items (name, quantity, notes, added_by, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, ?)`),
  getById:    db.prepare('SELECT * FROM items WHERE id = ?'),
  update:     db.prepare(`UPDATE items SET name = ?, quantity = ?, notes = ?, updated_at = ? WHERE id = ?`),
  setChecked: db.prepare('UPDATE items SET checked = ?, updated_at = ? WHERE id = ?'),
  remove:     db.prepare('DELETE FROM items WHERE id = ?'),
  clearChecked: db.prepare('DELETE FROM items WHERE checked = 1'),
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
