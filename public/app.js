// Family Shopping List — client
(() => {
  const $ = (sel) => document.querySelector(sel);
  const listTodo = $('#list-todo');
  const listDone = $('#list-done');
  const countTodo = $('#count-todo');
  const countDone = $('#count-done');
  const emptyMsg = $('#empty');
  const clearBtn = $('#clear-done');
  const conn = $('#conn');
  const whoami = $('#whoami');

  // Who am I — stored in localStorage so the "added by" chip persists on this device.
  whoami.value = localStorage.getItem('fsl:whoami') || '';
  whoami.addEventListener('input', () => {
    localStorage.setItem('fsl:whoami', whoami.value.trim());
  });

  // In-memory mirror of server state, keyed by id for quick updates from SSE.
  /** @type {Map<number, object>} */
  const byId = new Map();

  function render() {
    const items = [...byId.values()].sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
    listTodo.innerHTML = '';
    listDone.innerHTML = '';
    let nTodo = 0, nDone = 0;
    for (const it of items) {
      const li = renderItem(it);
      if (it.checked) { listDone.appendChild(li); nDone++; }
      else            { listTodo.appendChild(li); nTodo++; }
    }
    countTodo.textContent = String(nTodo);
    countDone.textContent = String(nDone);
    clearBtn.hidden = nDone === 0;
    emptyMsg.hidden = (nTodo + nDone) > 0;
  }

  function renderItem(it) {
    const li = document.createElement('li');
    li.className = 'item' + (it.checked ? ' checked' : '');
    li.dataset.id = String(it.id);

    // checkbox
    const cb = document.createElement('button');
    cb.type = 'button';
    cb.className = 'check';
    cb.setAttribute('aria-label', it.checked ? 'Mark as not purchased' : 'Mark as purchased');
    cb.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="3"><polyline points="2,9 6,13 14,3"/></svg>';
    cb.addEventListener('click', () => toggleChecked(it.id, !it.checked));

    // body
    const body = document.createElement('div');
    body.className = 'body';
    const name = document.createElement('div');
    name.className = 'name';
    const strong = document.createElement('strong');
    strong.textContent = it.name;
    name.appendChild(strong);
    if (it.quantity) {
      const q = document.createElement('span');
      q.className = 'qty';
      q.textContent = it.quantity;
      name.appendChild(q);
    }
    body.appendChild(name);
    if (it.notes || it.addedBy) {
      const meta = document.createElement('span');
      meta.className = 'meta';
      const parts = [];
      if (it.notes) parts.push(it.notes);
      if (it.addedBy) parts.push('— ' + it.addedBy);
      meta.textContent = parts.join(' ');
      body.appendChild(meta);
    }

    // actions
    const actions = document.createElement('div');
    actions.className = 'actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'icon-btn';
    editBtn.title = 'Edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => startEdit(li, it));
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Remove';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => removeItem(it.id));
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(cb);
    li.appendChild(body);
    li.appendChild(actions);
    return li;
  }

  function startEdit(li, it) {
    if (li.querySelector('.edit-row')) return; // already editing
    const row = document.createElement('div');
    row.className = 'edit-row';
    row.innerHTML = `
      <input class="e-name" type="text" maxlength="80" />
      <input class="e-qty"  type="text" maxlength="40" placeholder="qty" />
      <input class="e-note" type="text" maxlength="200" placeholder="notes" />
    `;
    row.querySelector('.e-name').value = it.name;
    row.querySelector('.e-qty').value  = it.quantity;
    row.querySelector('.e-note').value = it.notes;

    const actions = document.createElement('div');
    actions.className = 'edit-actions';
    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Save';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    actions.appendChild(save);
    actions.appendChild(cancel);

    const body = li.querySelector('.body');
    body.appendChild(row);
    body.appendChild(actions);
    row.querySelector('.e-name').focus();

    const finishEdit = () => { row.remove(); actions.remove(); };
    cancel.addEventListener('click', finishEdit);
    save.addEventListener('click', async () => {
      const patch = {
        name:     row.querySelector('.e-name').value.trim(),
        quantity: row.querySelector('.e-qty').value.trim(),
        notes:    row.querySelector('.e-note').value.trim(),
      };
      if (!patch.name) { row.querySelector('.e-name').focus(); return; }
      await api(`/api/items/${it.id}`, 'PATCH', patch);
      finishEdit();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save.click();
      if (e.key === 'Escape') finishEdit();
    });
  }

  // --- API helpers ----------------------------------------------------------
  async function api(url, method = 'GET', body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${method} ${url} -> ${r.status}`);
    return r.status === 204 ? null : r.json();
  }

  async function loadAll() {
    const { items } = await api('/api/items');
    byId.clear();
    for (const it of items) byId.set(it.id, it);
    render();
  }

  async function addItem({ name, quantity, notes }) {
    await api('/api/items', 'POST', {
      name, quantity, notes,
      addedBy: whoami.value.trim(),
    });
  }
  async function toggleChecked(id, checked) {
    await api(`/api/items/${id}`, 'PATCH', { checked });
  }
  async function removeItem(id) {
    await api(`/api/items/${id}`, 'DELETE');
  }
  async function clearChecked() {
    await api('/api/items/clear-checked', 'POST');
  }

  // --- wire up form ---------------------------------------------------------
  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#f-name').value.trim();
    const quantity = $('#f-qty').value.trim();
    const notes = $('#f-note').value.trim();
    if (!name) return;
    try {
      await addItem({ name, quantity, notes });
      $('#f-name').value = '';
      $('#f-qty').value = '';
      $('#f-note').value = '';
      $('#f-name').focus();
    } catch (err) {
      showConn('Failed to add — retrying…', true);
    }
  });

  clearBtn.addEventListener('click', () => {
    if (confirm('Remove all checked-off items from the list?')) clearChecked();
  });

  // --- Server-Sent Events ---------------------------------------------------
  let es;
  let connTimer;
  function showConn(msg, bad) {
    conn.textContent = msg;
    conn.classList.toggle('bad', !!bad);
    conn.classList.add('show');
    clearTimeout(connTimer);
    connTimer = setTimeout(() => conn.classList.remove('show'), 2000);
  }

  function connect() {
    if (es) es.close();
    es = new EventSource('/api/stream');
    es.addEventListener('open', () => showConn('Connected', false));
    es.addEventListener('error', () => {
      showConn('Reconnecting…', true);
      // EventSource auto-reconnects; also resync state on reconnect.
    });
    es.addEventListener('item:created', (e) => {
      const it = JSON.parse(e.data); byId.set(it.id, it); render();
    });
    es.addEventListener('item:updated', (e) => {
      const it = JSON.parse(e.data); byId.set(it.id, it); render();
    });
    es.addEventListener('item:deleted', (e) => {
      const { id } = JSON.parse(e.data); byId.delete(id); render();
    });
    es.addEventListener('items:cleared-checked', () => {
      loadAll();
    });
  }

  // Refresh on tab refocus in case we missed events while suspended.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') loadAll();
  });

  // --- boot -----------------------------------------------------------------
  loadAll().catch(() => showConn('Could not reach server', true));
  connect();
})();
