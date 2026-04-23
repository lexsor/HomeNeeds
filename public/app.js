// HomeNeeds — client
(() => {
  const $ = (sel) => document.querySelector(sel);
  const listTodo = $('#list-todo');
  const listDone = $('#list-done');
  const countTodo = $('#count-todo');
  const countDone = $('#count-done');
  const emptyMsg = $('#empty');
  const doneBtn  = $('#done-shopping');
  const conn = $('#conn');
  const whoami = $('#whoami');

  // Favorites elements
  const favWrap   = $('#favorites-wrap');
  const favToggle = $('#favorites-toggle');
  const favPanel  = $('#favorites-panel');
  const favList   = $('#list-fav');
  const favEmpty  = $('#fav-empty');
  const countFav  = $('#count-fav');

  // --- roster (per-person color coding) -------------------------------------
  // Keys are lowercase for case-insensitive match. `label` is the display name
  // used in the colored chip; `cls` is the CSS class that drives the color.
  const ROSTER = {
    'dad':    { label: 'Dad',    cls: 'by-dad'    },
    'mom':    { label: 'Mom',    cls: 'by-mom'    },
    'keaton': { label: 'Keaton', cls: 'by-keaton' },
    'juls':   { label: 'Juls',   cls: 'by-juls'   },
  };
  function rosterFor(name) {
    if (!name) return null;
    return ROSTER[String(name).trim().toLowerCase()] || null;
  }

  // Who am I — stored in localStorage so the "added by" tag persists on this device.
  whoami.value = localStorage.getItem('fsl:whoami') || '';
  whoami.addEventListener('input', () => {
    localStorage.setItem('fsl:whoami', whoami.value.trim());
  });

  // In-memory mirror of server state, keyed by id for quick updates from SSE.
  /** @type {Map<number, object>} */
  const byId = new Map();
  /** @type {Map<number, object>}  favorites by id */
  const favById = new Map();

  // Favorites lookup by lowercase name — used to decide whether an item's
  // star is filled in (already favorited) or hollow (can be saved).
  function favByName(name) {
    if (!name) return null;
    const key = String(name).trim().toLowerCase();
    for (const f of favById.values()) {
      if (f.name.toLowerCase() === key) return f;
    }
    return null;
  }

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
    doneBtn.hidden = nDone === 0;
    emptyMsg.hidden = (nTodo + nDone) > 0;
  }

  function renderFavorites() {
    const favs = [...favById.values()].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    );
    favList.innerHTML = '';
    // Names already on the active list — used to dim/disable matching favorites
    // so we don't double-add the same thing.
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
    // Hide the whole panel when there are zero favs AND the panel is collapsed,
    // so we don't show an empty chrome to a user who's never starred anything.
    // Once the user expands it, we keep it visible so the "no favorites yet"
    // hint can teach them what stars do.
    const expanded = favToggle.getAttribute('aria-expanded') === 'true';
    favWrap.hidden = favs.length === 0 && !expanded;
  }

  function renderItem(it) {
    const li = document.createElement('li');
    const role = rosterFor(it.addedBy);
    li.className = 'item' + (it.checked ? ' checked' : '') + (role ? ' ' + role.cls : '');
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

    // meta line: optional note text + colored "added by" chip
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
        chip.className = 'by-chip' + (role ? ' ' + role.cls : '');
        chip.textContent = role ? role.label : it.addedBy;
        meta.appendChild(chip);
      }
      body.appendChild(meta);
    }

    // actions
    const actions = document.createElement('div');
    actions.className = 'actions';

    // Star — toggle favorite for this item's name. Filled when favorited.
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
    renderFavorites(); // active list changed -> "already on list" badges may shift
  }

  async function loadFavorites() {
    const { favorites } = await api('/api/favorites');
    favById.clear();
    for (const f of favorites) favById.set(f.id, f);
    renderFavorites();
    render(); // re-render items so star fills update
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

  // --- favorites actions ----------------------------------------------------
  async function toggleFavoriteForItem(it) {
    const existing = favByName(it.name);
    if (existing) {
      await api(`/api/favorites/${existing.id}`, 'DELETE');
    } else {
      await api('/api/favorites', 'POST', { name: it.name, quantity: it.quantity, notes: it.notes });
    }
  }
  async function removeFavorite(id) {
    await api(`/api/favorites/${id}`, 'DELETE');
  }
  // Re-add a favorite to the active shopping list. Skip if it's already there
  // (case-insensitive match) so a quick double-tap doesn't create duplicates.
  async function addFromFavorite(f) {
    const onList = [...byId.values()].some(
      (it) => it.name.trim().toLowerCase() === f.name.toLowerCase()
    );
    if (onList) {
      showConn(`${f.name} is already on the list`, false);
      return;
    }
    await addItem({ name: f.name, quantity: f.quantity || '', notes: f.notes });
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

  doneBtn.addEventListener('click', () => {
    const n = countDone.textContent;
    if (confirm(`Clear all ${n} item(s) from the cart?`)) clearChecked();
  });

  // Favorites panel toggle (collapsed by default to keep the top of the
  // screen quiet — it expands when the user wants to manage favorites).
  favToggle.addEventListener('click', () => {
    const expanded = favToggle.getAttribute('aria-expanded') === 'true';
    favToggle.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    favPanel.hidden = expanded;
    // Re-evaluate auto-hide of the whole panel chrome when collapsing back.
    if (expanded) renderFavorites();
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
    es.addEventListener('favorite:created', (e) => {
      const f = JSON.parse(e.data); favById.set(f.id, f);
      renderFavorites();
      render(); // star fills depend on favorites map
    });
    es.addEventListener('favorite:deleted', (e) => {
      const { id } = JSON.parse(e.data); favById.delete(id);
      renderFavorites();
      render();
    });
  }

  // Refresh on tab refocus in case we missed events while suspended.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadAll();
      loadFavorites();
    }
  });

  // --- boot -----------------------------------------------------------------
  Promise.all([loadAll(), loadFavorites()])
    .catch(() => showConn('Could not reach server', true));
  connect();
})();
