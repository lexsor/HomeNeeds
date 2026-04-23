// HomeNeeds — server
// Express + SQLite (better-sqlite3) + Server-Sent Events for real-time sync.

const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');
const QRCode = require('qrcode');

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

// Ensure .webmanifest is served with the correct MIME type.
express.static.mime.define({ 'application/manifest+json': ['webmanifest'] });
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // Never cache the service worker itself so updates roll out fast.
    if (filePath.endsWith(`${path.sep}sw.js`) || filePath.endsWith('/sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

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

// --- QR code ---------------------------------------------------------------
// GET /qr     -> a print-friendly page with the QR + URL
// GET /qr.svg -> raw QR as an SVG (for embedding)
function siteUrlFrom(req) {
  // Honor reverse-proxy headers if present; fall back to the host header.
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host  = (req.headers['x-forwarded-host']  || req.headers['host']).split(',')[0].trim();
  return `${proto}://${host}/`;
}

app.get('/qr.svg', async (req, res) => {
  const url = siteUrlFrom(req);
  try {
    const svg = await QRCode.toString(url, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 512,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
    res.set('Content-Type', 'image/svg+xml').send(svg);
  } catch (e) {
    res.status(500).send('qr error');
  }
});

app.get('/qr', async (req, res) => {
  const url = siteUrlFrom(req);
  let svg = '';
  try {
    svg = await QRCode.toString(url, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1, width: 512,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch (_) {
    return res.status(500).send('qr error');
  }
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>HomeNeeds — scan to open</title>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  @page { margin: 14mm; }
  html,body { margin:0; padding:0; background:#fff; color:#0f172a; }
  body { font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display:flex; flex-direction:column; align-items:center; padding:28px 18px; }
  h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: .5px; }
  p.sub { margin: 0 0 22px; color:#475569; }
  .card { border:1px solid #e2e8f0; border-radius: 16px; padding: 18px; box-shadow: 0 6px 22px rgba(15,23,42,.06); background:#fff; }
  .qr { width: min(70vmin, 420px); height: auto; display:block; }
  .url { margin-top: 18px; font-weight: 600; font-size: 20px; word-break: break-all; text-align:center; }
  .hint { margin-top: 10px; color:#64748b; text-align:center; max-width: 52ch; }
  .actions { margin-top: 18px; }
  button { background:#0f172a; color:#fff; border:0; border-radius:10px; padding:10px 14px; cursor:pointer; font: inherit; font-weight:600; }
  @media print { .actions, .hint { display:none; } body { padding: 0; } .card { border: 0; box-shadow: none; } }
</style>
</head>
<body>
  <h1>HomeNeeds</h1>
  <p class="sub">Scan to open the shared shopping list.</p>
  <div class="card">${svg.replace('<svg', '<svg class="qr"')}</div>
  <div class="url">${url}</div>
  <p class="hint">On Android, after it opens in Chrome tap the menu → <b>Add to Home screen</b> to install.</p>
  <div class="actions"><button onclick="window.print()">Print</button></div>
</body>
</html>`;
  res.type('text/html').send(html);
});

app.listen(PORT, () => {
  console.log(`[home-needs] listening on :${PORT}  (db: ${DB_PATH})`);
});
