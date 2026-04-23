# HomeNeeds

A small self-hosted webapp for a family of 4 to share a single shopping list. Anyone can add items from their phone or laptop, and whoever goes to the store just pulls up the page and checks things off. Changes sync to everyone's device in real time (Server-Sent Events).

## Features

- Add, edit, and remove items
- Quantity and free-text notes per item (e.g. `2` / `whole wheat`)
- Check off items while shopping — they move to an "In the cart" section
- **Favorites (★)** — star any item to save it as a shared family favorite. A collapsible "Favorites" panel above the list lets anyone re-add a favorite to the list with one tap (saved quantity and notes come along)
- **Done shopping** button — big primary button that clears the entire cart in one tap when you're back from the store
- Optional per-device "You:" name — items are tagged with who added them
- Real-time sync across all connected devices
- Offline-first phone/PWA mode: the latest list and favorites are cached on-device, and changes made while offline sync back to the server when the phone reconnects
- Mobile-first layout

## Stack

- **Backend:** Node.js 20 + Express, SQLite via `better-sqlite3`
- **Frontend:** Vanilla HTML/CSS/JS (no build step)
- **Live sync:** Server-Sent Events (`/api/stream`)
- **Storage:** SQLite file in `./data/list.db` (mounted as a Docker volume)

## Run with Docker (recommended)

From this directory:

```bash
docker compose up -d --build
```

Then open `http://<your-homelab-ip>:3000` on any device on your network.

The SQLite database lives in `./data/list.db` on the host, so container rebuilds don't lose the list.

To update:

```bash
docker compose pull || true
docker compose up -d --build
```

To stop:

```bash
docker compose down
```

## Run locally (without Docker)

```bash
npm install
npm start
# -> http://localhost:3000
```

## HTTP API

| Method | Path                          | Body                                              | Returns               |
| ------ | ----------------------------- | ------------------------------------------------- | --------------------- |
| GET    | `/api/items`                  | —                                                 | `{ items: [] }`       |
| POST   | `/api/items`                  | `{ name, quantity?, notes?, addedBy? }`           | created item          |
| PATCH  | `/api/items/:id`              | any of `{ name, quantity, notes, checked }`       | updated item          |
| DELETE | `/api/items/:id`              | —                                                 | 204                   |
| POST   | `/api/items/clear-checked`    | —                                                 | `{ count }`           |
| GET    | `/api/favorites`              | —                                                 | `{ favorites: [] }`   |
| POST   | `/api/favorites`              | `{ name, quantity?, notes? }`                     | created/updated favorite (idempotent on name, case-insensitive) |
| DELETE | `/api/favorites/:id`          | —                                                 | 204                   |
| DELETE | `/api/favorites?name=...`     | —                                                 | 204                   |
| GET    | `/api/stream`                 | (SSE)                                             | live events           |
| GET    | `/api/health`                 | —                                                 | `{ ok: true }`        |

SSE event names: `item:created`, `item:updated`, `item:deleted`, `items:cleared-checked`, `favorite:created`, `favorite:deleted`.

## Configuration

Environment variables:

- `PORT` — HTTP port (default `3000`)
- `DATA_DIR` — where `list.db` is stored (default `./data`, set to `/data` inside the container)

## Notes

- There is no authentication — this is designed to run on your home LAN. If you expose it publicly, put it behind an auth-ing reverse proxy (Authelia, Authentik, Tailscale, Cloudflare Access, etc.).
- The "You:" name is stored in each device's `localStorage`, so it only has to be set once per phone/laptop.
