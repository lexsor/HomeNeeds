// HomeNeeds — client
(() => {
  const $ = (sel) => document.querySelector(sel);
  const listTodo = $('#list-todo');
  const listDone = $('#list-done');
  const countTodo = $('#count-todo');
  const countDone = $('#count-done');
  const emptyMsg = $('#empty');
  const doneBtn = $('#done-shopping');
  const conn = $('#conn');
  const whoami = $('#whoami');

  // Favorites elements
  const favWrap = $('#favorites-wrap');
  const favToggle = $('#favorites-toggle');
  const favPanel = $('#favorites-panel');
  const favList = $('#list-fav');
  const favEmpty = $('#fav-empty');
  const countFav = $('#count-fav');

  const STORAGE_KEYS = {
    whoami: 'fsl:whoami',
    items: 'fsl:items-cache',
    favorites: 'fsl:favorites-cache',
    queue: 'fsl:pending-ops',
    tempSeq: 'fsl:temp-seq',
  };

  const OP = {
    ITEM_ADD: 'item:add',
    ITEM_PATCH: 'item:patch',
    ITEM_DELETE: 'item:delete',
    ITEM_CLEAR_CHECKED: 'item:clearChecked',
    FAVORITE_UPSERT: 'favorite:upsert',
    FAVORITE_DELETE: 'favorite:delete',
  };

  // --- roster (per-person color coding) -------------------------------------
  const ROSTER = {
    dad: { label: 'Dad', cls: 'by-dad' },
    mom: { label: 'Mom', cls: 'by-mom' },
    keaton: { label: 'Keaton', cls: 'by-keaton' },
    juls: { label: 'Juls', cls: 'by-juls' },
  };
  function rosterFor(name) {
    if (!name) return null;
    return ROSTER[String(name).trim().toLowerCase()] || null;
  }

  whoami.value = localStorage.getItem(STORAGE_KEYS.whoami) || '';
  whoami.addEventListener('input', () => {
    localStorage.setItem(STORAGE_KEYS.whoami, whoami.value.trim());
  });

  /** @type {Map<number|string, object>} */
  const byId = new Map();
  /** @type {Map<number|string, object>} */
  const favById = new Map();
  /** @type {Array<object>} */
  const pendingOps = readJson(STORAGE_KEYS.queue, []);

  let es;
  let connTimer;
  let flushPromise = null;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function nextTempId(prefix) {
    const seq = parseInt(localStorage.getItem(STORAGE_KEYS.tempSeq) || '0', 10) + 1;
    localStorage.setItem(STORAGE_KEYS.tempSeq, String(seq));
    return `${prefix}-${Date.now()}-${seq}`;
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function persistItems() {
    writeJson(STORAGE_KEYS.items, [...byId.values()]);
  }

  function persistFavorites() {
    writeJson(STORAGE_KEYS.favorites, [...favById.values()]);
  }

  function persistQueue() {
    writeJson(STORAGE_KEYS.queue, pendingOps);
  }

  function restoreCachedState() {
    const cachedItems = readJson(STORAGE_KEYS.items, []);
    const cachedFavorites = readJson(STORAGE_KEYS.favorites, []);

    byId.clear();
    for (const it of cachedItems) byId.set(it.id, it);

    favById.clear();
    for (const fav of cachedFavorites) favById.set(fav.id, fav);
  }

  function upsertPendingOp(op) {
    pendingOps.push(op);
    persistQueue();
  }

  function removePendingOps(predicate) {
    let changed = false;
    for (let i = pendingOps.length - 1; i >= 0; i -= 1) {
      if (predicate(pendingOps[i])) {
        pendingOps.splice(i, 1);
        changed = true;
      }
    }
    if (changed) persistQueue();
  }

  function findPendingItemAdd(id) {
    return pendingOps.find((op) => op.type === OP.ITEM_ADD && op.tempId === id) || null;
  }

  function findPendingFavoriteUpsert(id) {
    return pendingOps.find((op) => op.type === OP.FAVORITE_UPSERT && op.tempId === id) || null;
  }

  function favByName(name) {
    if (!name) return null;
    const key = String(name).trim().toLowerCase();
    for (const f of favById.values()) {
      if (f.name.toLowerCase() === key) return f;
    }
    return null;
  }

  function itemExistsByName(name) {
    const key = String(name || '').trim().toLowerCase();
    return [...byId.values()].some((it) => it.name.trim().toLowerCase() === key);
  }

  function showConn(msg, bad) {
    conn.textContent = msg;
    conn.classList.toggle('bad', !!bad);
    conn.classList.add('show');
    clearTimeout(connTimer);
    connTimer = setTimeout(() => conn.classList.remove('show'), 2500);
  }

  function pendingSummary() {
    if (!pendingOps.length) return '';
    return pendingOps.length === 1 ? '1 change pending sync' : `${pendingOps.length} changes pending sync`;
  }

  function render() {
    const items = [...byId.values()].sort((a, b) => {
      if (a.checked !== b.checked) return a.checked ? 1 : -1;
      return a.createdAt - b.createdAt;
    });
    listTodo.innerHTML = '';
    listDone.innerHTML = '';
    let nTodo = 0;
    let nDone = 0;
    for (const it of items) {
      const li = renderItem(it);
      if (it.checked) {
        listDone.appendChild(li);
        nDone += 1;
      } else {
        listTodo.appendChild(li);
        nTodo += 1;
      }
    }
    countTodo.textContent = String(nTodo);
    countDone.textContent = String(nDone);
    doneBtn.hidden = nDone === 0;
    emptyMsg.hidden = (nTodo + nDone) > 0;
  }

  function renderFavorites() {
    const favs = [...favById.values()].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
    favList.innerHTML = '';
    const onList = new Set(
      [...byId.values()].map((it) => it.name.trim().toLowerCase())
    );
    for (const f of favs) {
      const li = document.createElement('li');
      li.className = 'fav';
      const already = onList.has(f.name.toLowerCase());
      if (already) li.classList.add('on-list');

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'fav-add';
      add.title = already ? 'Already on the list' : 'Add to list';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'fav-name';
      nameSpan.textContent = f.name;
      add.appendChild(nameSpan);
      if (f.quantity) {
        const qtySpan = document.createElement('span');
        qtySpan.className = 'fav-qty';
        qtySpan.textContent = f.quantity;
        add.appendChild(qtySpan);
      }
      if (f.notes) {
        const noteSpan = document.createElement('span');
        noteSpan.className = 'fav-note';
        noteSpan.textContent = f.notes;
        add.appendChild(noteSpan);
      }
      add.addEventListener('click', () => addFromFavorite(f));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'fav-del';
      del.title = 'Remove favorite';
      del.setAttribute('aria-label', `Remove ${f.name} from favorites`);
      del.textContent = '\u2715';
      del.addEventListener('click', () => removeFavorite(f.id));

      li.appendChild(add);
      li.appendChild(del);
      favList.appendChild(li);
    }
    countFav.textContent = String(favs.length);
    favEmpty.hidden = favs.length > 0;
    const expanded = favToggle.getAttribute('aria-expanded') === 'true';
    favWrap.hidden = favs.length === 0 && !expanded;
  }

  function renderItem(it) {
    const li = document.createElement('li');
    const role = rosterFor(it.addedBy);
    li.className = 'item' + (it.checked ? ' checked' : '') + (role ? ` ${role.cls}` : '');
    if (it.pendingSync) li.classList.add('pending-sync');
    li.dataset.id = String(it.id);

    const cb = document.createElement('button');
    cb.type = 'button';
    cb.className = 'check';
    cb.setAttribute('aria-label', it.checked ? 'Mark as not purchased' : 'Mark as purchased');
    cb.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="3"><polyline points="2,9 6,13 14,3"/></svg>';
    cb.addEventListener('click', () => toggleChecked(it.id, !it.checked));

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
    if (it.pendingSync) {
      const badge = document.createElement('span');
      badge.className = 'qty pending-badge';
      badge.textContent = 'offline';
      name.appendChild(badge);
    }
    body.appendChild(name);

    if (it.notes || it.addedBy) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      if (it.notes) {
        const note = document.createElement('span');
        note.className = 'note';
        note.textContent = it.notes;
        meta.appendChild(note);
      }
      if (it.addedBy) {
        const chip = document.createElement('span');
        chip.className = 'by-chip' + (role ? ` ${role.cls}` : '');
        chip.textContent = role ? role.label : it.addedBy;
        meta.appendChild(chip);
      }
      body.appendChild(meta);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';

    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    const isFav = !!favByName(it.name);
    starBtn.className = 'icon-btn star-btn' + (isFav ? ' favorited' : '');
    starBtn.title = isFav ? 'Unfavorite' : 'Save as favorite';
    starBtn.setAttribute('aria-label', starBtn.title);
    starBtn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
    starBtn.innerHTML = `
      <svg class="star-icon" viewBox="0 0 20 20" aria-hidden="true">
        <polygon points="10,2 12.59,7.36 18.51,8.16 14.25,12.26 15.18,18.09 10,15.34 4.82,18.09 5.75,12.26 1.49,8.16 7.41,7.36"/>
      </svg>`;
    starBtn.addEventListener('click', () => toggleFavoriteForItem(it));

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
    delBtn.textContent = '\u2715';
    delBtn.addEventListener('click', () => removeItem(it.id));

    actions.appendChild(starBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(cb);
    li.appendChild(body);
    li.appendChild(actions);
    return li;
  }

  function startEdit(li, it) {
    if (li.querySelector('.edit-row')) return;
    const row = document.createElement('div');
    row.className = 'edit-row';
    row.innerHTML = `
      <input class="e-name" type="text" maxlength="80" />
      <input class="e-qty" type="text" maxlength="40" placeholder="qty" />
      <input class="e-note" type="text" maxlength="200" placeholder="notes" />
    `;
    row.querySelector('.e-name').value = it.name;
    row.querySelector('.e-qty').value = it.quantity;
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

    const finishEdit = () => {
      row.remove();
      actions.remove();
    };
    cancel.addEventListener('click', finishEdit);
    save.addEventListener('click', async () => {
      const patch = {
        name: row.querySelector('.e-name').value.trim(),
        quantity: row.querySelector('.e-qty').value.trim(),
        notes: row.querySelector('.e-note').value.trim(),
      };
      if (!patch.name) {
        row.querySelector('.e-name').focus();
        return;
      }
      await patchItem(it.id, patch);
      finishEdit();
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save.click();
      if (e.key === 'Escape') finishEdit();
    });
  }

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

  function replaceItemId(oldId, freshItem) {
    byId.delete(oldId);
    byId.set(freshItem.id, { ...freshItem, pendingSync: false });
    persistItems();
    render();
    renderFavorites();
  }

  function replaceFavoriteId(oldId, freshFavorite) {
    favById.delete(oldId);
    favById.set(freshFavorite.id, { ...freshFavorite, pendingSync: false });
    persistFavorites();
    renderFavorites();
    render();
  }

  function markItemPending(item) {
    byId.set(item.id, { ...item, pendingSync: true });
    persistItems();
    render();
    renderFavorites();
  }

  function markFavoritePending(favorite) {
    favById.set(favorite.id, { ...favorite, pendingSync: true });
    persistFavorites();
    renderFavorites();
    render();
  }

  async function loadAll() {
    const payload = await api('/api/items');
    if (!Array.isArray(payload?.items)) throw new Error('Invalid items payload');
    byId.clear();
    for (const it of payload.items) byId.set(it.id, { ...it, pendingSync: false });
    persistItems();
    render();
    renderFavorites();
  }

  async function loadFavorites() {
    const payload = await api('/api/favorites');
    if (!Array.isArray(payload?.favorites)) throw new Error('Invalid favorites payload');
    favById.clear();
    for (const f of payload.favorites) favById.set(f.id, { ...f, pendingSync: false });
    persistFavorites();
    renderFavorites();
    render();
  }

  async function refreshFromServer() {
    await Promise.all([loadAll(), loadFavorites()]);
  }

  function queueStatusMessage() {
    if (pendingOps.length) showConn(pendingSummary(), true);
  }

  async function addItem({ name, quantity, notes }) {
    const tempId = nextTempId('item');
    const now = Date.now();
    const item = {
      id: tempId,
      name,
      quantity,
      notes,
      checked: false,
      addedBy: whoami.value.trim(),
      createdAt: now,
      updatedAt: now,
      pendingSync: true,
    };
    markItemPending(item);
    upsertPendingOp({
      type: OP.ITEM_ADD,
      tempId,
      body: {
        name,
        quantity,
        notes,
        addedBy: item.addedBy,
      },
    });
    showConn(navigator.onLine ? 'Saving…' : 'Saved offline on this phone', !navigator.onLine);
    return flushQueue();
  }

  async function patchItem(id, patch) {
    const current = byId.get(id);
    if (!current) return;
    const updated = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      pendingSync: true,
    };
    markItemPending(updated);

    const pendingAdd = findPendingItemAdd(id);
    if (pendingAdd) {
      if (patch.name !== undefined) pendingAdd.body.name = patch.name;
      if (patch.quantity !== undefined) pendingAdd.body.quantity = patch.quantity;
      if (patch.notes !== undefined) pendingAdd.body.notes = patch.notes;
      if (patch.checked !== undefined) {
        removePendingOps((op) => op.type === OP.ITEM_PATCH && op.id === id);
        upsertPendingOp({ type: OP.ITEM_PATCH, id, body: { checked: patch.checked } });
      } else {
        persistQueue();
      }
    } else {
      removePendingOps((op) => op.type === OP.ITEM_PATCH && op.id === id);
      upsertPendingOp({ type: OP.ITEM_PATCH, id, body: clone(patch) });
    }

    return flushQueue();
  }

  async function toggleChecked(id, checked) {
    return patchItem(id, { checked });
  }

  async function removeItem(id) {
    const current = byId.get(id);
    if (!current) return;
    byId.delete(id);
    persistItems();
    render();
    renderFavorites();

    const pendingAdd = findPendingItemAdd(id);
    if (pendingAdd) {
      removePendingOps((op) => op.tempId === id || op.id === id);
    } else {
      removePendingOps((op) =>
        (op.type === OP.ITEM_PATCH || op.type === OP.ITEM_DELETE) && op.id === id
      );
      upsertPendingOp({ type: OP.ITEM_DELETE, id });
    }

    return flushQueue();
  }

  async function clearChecked() {
    const checkedIds = [...byId.values()].filter((it) => it.checked).map((it) => it.id);
    if (!checkedIds.length) return;

    for (const id of checkedIds) byId.delete(id);
    persistItems();
    render();
    renderFavorites();

    removePendingOps((op) => {
      if (op.type === OP.ITEM_CLEAR_CHECKED) return true;
      if (op.type === OP.ITEM_ADD && checkedIds.includes(op.tempId)) return true;
      if ((op.type === OP.ITEM_PATCH || op.type === OP.ITEM_DELETE) && checkedIds.includes(op.id)) return true;
      return false;
    });
    upsertPendingOp({ type: OP.ITEM_CLEAR_CHECKED });
    showConn(navigator.onLine ? 'Clearing cart…' : 'Cart cleared offline on this phone', !navigator.onLine);
    return flushQueue();
  }

  async function toggleFavoriteForItem(it) {
    const existing = favByName(it.name);
    if (existing) {
      return removeFavorite(existing.id);
    }

    const tempId = nextTempId('fav');
    const favorite = {
      id: tempId,
      name: it.name,
      quantity: it.quantity || '',
      notes: it.notes || '',
      createdAt: Date.now(),
      pendingSync: true,
    };
    markFavoritePending(favorite);
    upsertPendingOp({
      type: OP.FAVORITE_UPSERT,
      tempId,
      body: {
        name: favorite.name,
        quantity: favorite.quantity,
        notes: favorite.notes,
      },
    });
    return flushQueue();
  }

  async function removeFavorite(id) {
    const current = favById.get(id);
    if (!current) return;
    favById.delete(id);
    persistFavorites();
    renderFavorites();
    render();

    const pendingUpsert = findPendingFavoriteUpsert(id);
    if (pendingUpsert) {
      removePendingOps((op) => op.tempId === id);
    } else {
      removePendingOps((op) => op.type === OP.FAVORITE_DELETE && op.id === id);
      upsertPendingOp({ type: OP.FAVORITE_DELETE, id, name: current.name });
    }

    return flushQueue();
  }

  async function addFromFavorite(f) {
    if (itemExistsByName(f.name)) {
      showConn(`${f.name} is already on the list`, false);
      return;
    }
    return addItem({ name: f.name, quantity: f.quantity || '', notes: f.notes });
  }

  async function flushQueue() {
    if (!pendingOps.length) return Promise.resolve();
    if (!navigator.onLine) {
      queueStatusMessage();
      return Promise.resolve();
    }
    if (flushPromise) return flushPromise;

    flushPromise = (async () => {
      const tempIds = new Map();

      while (pendingOps.length) {
        const op = pendingOps[0];
        try {
          if (op.type === OP.ITEM_ADD) {
            const created = await api('/api/items', 'POST', op.body);
            tempIds.set(op.tempId, created.id);
            replaceItemId(op.tempId, created);
          } else if (op.type === OP.ITEM_PATCH) {
            const id = tempIds.get(op.id) || op.id;
            if (typeof id !== 'number') {
              pendingOps.shift();
              persistQueue();
              continue;
            }
            const updated = await api(`/api/items/${id}`, 'PATCH', op.body);
            byId.set(updated.id, { ...updated, pendingSync: false });
            persistItems();
            render();
            renderFavorites();
          } else if (op.type === OP.ITEM_DELETE) {
            const id = tempIds.get(op.id) || op.id;
            if (typeof id === 'number') {
              await api(`/api/items/${id}`, 'DELETE');
            }
          } else if (op.type === OP.ITEM_CLEAR_CHECKED) {
            await api('/api/items/clear-checked', 'POST');
          } else if (op.type === OP.FAVORITE_UPSERT) {
            const favorite = await api('/api/favorites', 'POST', op.body);
            tempIds.set(op.tempId, favorite.id);
            replaceFavoriteId(op.tempId, favorite);
          } else if (op.type === OP.FAVORITE_DELETE) {
            const id = tempIds.get(op.id) || op.id;
            if (typeof id === 'number') {
              await api(`/api/favorites/${id}`, 'DELETE');
            } else if (op.name) {
              await api(`/api/favorites?name=${encodeURIComponent(op.name)}`, 'DELETE');
            }
          }

          pendingOps.shift();
          persistQueue();
        } catch (_) {
          queueStatusMessage();
          throw _;
        }
      }

      showConn('Synced', false);
      return true;
    })().catch(() => {
      queueStatusMessage();
      return false;
    }).finally(() => {
      flushPromise = null;
    });

    return flushPromise;
  }

  $('#add-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#f-name').value.trim();
    const quantity = $('#f-qty').value.trim();
    const notes = $('#f-note').value.trim();
    if (!name) return;
    await addItem({ name, quantity, notes });
    $('#f-name').value = '';
    $('#f-qty').value = '';
    $('#f-note').value = '';
    $('#f-name').focus();
  });

  doneBtn.addEventListener('click', () => {
    const n = countDone.textContent;
    if (confirm(`Clear all ${n} item(s) from the cart?`)) clearChecked();
  });

  favToggle.addEventListener('click', () => {
    const expanded = favToggle.getAttribute('aria-expanded') === 'true';
    favToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    favPanel.hidden = expanded;
    if (expanded) renderFavorites();
  });

  function connect() {
    if (es) es.close();
    es = new EventSource('/api/stream');
    es.addEventListener('open', async () => {
      showConn('Connected', false);
      const synced = await flushQueue();
      try {
        if (!pendingOps.length || synced) await refreshFromServer();
      } catch (_) {
        queueStatusMessage();
      }
    });
    es.addEventListener('error', () => {
      if (navigator.onLine) showConn('Trying to reconnect…', true);
      else queueStatusMessage();
    });
    es.addEventListener('item:created', (e) => {
      const it = JSON.parse(e.data);
      byId.set(it.id, { ...it, pendingSync: false });
      persistItems();
      render();
      renderFavorites();
    });
    es.addEventListener('item:updated', (e) => {
      const it = JSON.parse(e.data);
      byId.set(it.id, { ...it, pendingSync: false });
      persistItems();
      render();
      renderFavorites();
    });
    es.addEventListener('item:deleted', (e) => {
      const { id } = JSON.parse(e.data);
      byId.delete(id);
      persistItems();
      render();
      renderFavorites();
    });
    es.addEventListener('items:cleared-checked', () => {
      loadAll().catch(() => queueStatusMessage());
    });
    es.addEventListener('favorite:created', (e) => {
      const f = JSON.parse(e.data);
      favById.set(f.id, { ...f, pendingSync: false });
      persistFavorites();
      renderFavorites();
      render();
    });
    es.addEventListener('favorite:deleted', (e) => {
      const { id } = JSON.parse(e.data);
      favById.delete(id);
      persistFavorites();
      renderFavorites();
      render();
    });
  }

  window.addEventListener('online', async () => {
    showConn('Back online - syncing phone changes…', false);
    const synced = await flushQueue();
    if (synced && !pendingOps.length) {
      refreshFromServer().catch(() => queueStatusMessage());
    }
  });

  window.addEventListener('offline', () => {
    showConn('Offline - changes stay on this phone', true);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      flushQueue().then((synced) => {
        if (!pendingOps.length || synced) {
          refreshFromServer().catch(() => queueStatusMessage());
        }
      });
    }
  });

  restoreCachedState();
  render();
  renderFavorites();
  if (pendingOps.length) queueStatusMessage();

  flushQueue()
    .then((synced) => {
      if (!pendingOps.length || synced) return refreshFromServer();
      return null;
    })
    .catch(() => {
      if (!byId.size && !favById.size) showConn('Offline - using phone cache', true);
      else queueStatusMessage();
    });
  connect();
})();
