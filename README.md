# WORLDFORGE — Interactive Lore Map with Collaboration

A static D3/topojson world map where you click countries to write lore, recolor
them, upload flags, rename them, and bind them into realms. Optional **real-time
collaboration** via Vercel serverless Functions.

## Features
- 177 countries (Natural Earth 110m), offline-capable (libs vendored).
- Per-country: **lore**, **color**, **flag** (URL or upload), **rename**.
- **Realms**: shift+click countries to stage, bind into a shared realm with
  dashed border bonds between adjacent members.
- **Search**, zoom/pan, JSON export/import, localStorage persistence.
- **Collaborate** (optional): create a room → share a link → others join and
  edit the same world live (poll-sync every 5s, presence dots).

## Security model (collab)
- Each room gets a random `roomId` + secret `writeKey`. The key lives only in
  the share URL. Writes require the key (`401` otherwise).
- Per-field **last-write-wins** by timestamp — concurrent edits don't silently
  clobber.
- Rate limit (50 req/min/IP), 200 KB payload cap, input validation.
- Read-only mode available by sharing the link *without* the key.

## Deploy (Vercel — required for collaboration)
```bash
npm i -g vercel
vercel login
vercel env add KV_REST_API_URL   # optional: Vercel KV for persistence
vercel env add KV_REST_API_TOKEN # optional
vercel deploy --prod
```
Without KV, rooms live in serverless memory (resets on cold starts). For durable
rooms, bind **Vercel KV** in the dashboard and set the two env vars above.

Local dev:
```bash
vercel dev   # serves static + /api locally
```

## GitHub Pages (static only, no collaboration)
The same `index.html` works on GitHub Pages as a single-player offline app
(localStorage). The `/api/room/*` calls will 404 there, so the Collaborate
button won't create rooms — use the Vercel deploy for multiplayer.

## File layout
```
index.html              UI + modal + styles
app.js                  map, panel, realms, collab wiring
collab.js               Collab client (poll-sync, presence)
countries-110m.json     map geometry
d3.min.js, topojson-client.min.js
api/room/[id]/index.js  GET/POST room handler
api/room/store.js       store + security helpers
api/room/kv-helper.js   KV adapter (falls back to memory)
vercel.json
```
