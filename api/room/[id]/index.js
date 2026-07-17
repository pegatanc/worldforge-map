// /api/room/[id]
// GET  -> serialized world state (read-only, no token)
// POST -> { op:"create" } | { op:"patch", token, patch } | { op:"heartbeat", name, color }
import {
  loadRoom, saveRoom, storeToken, checkToken,
  genId, genToken, applyPatch, rateLimit, payloadOk, serialize,
} from "../store.js";

export const config = { runtime: "edge" };

// In the Vercel Edge runtime, handlers receive (request) only.
// The room id is the last path segment of /api/room/<id>.
function roomIdFromReq(req) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] || "x";
}

export async function GET(req) {
  const id = roomIdFromReq(req);
  const room = await loadRoom(id);
  if (!room) {
    return new Response(JSON.stringify({ error: "room not found" }), { status: 404 });
  }
  return new Response(JSON.stringify(serialize(room)), {
    status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(req) {
  const id = roomIdFromReq(req);
  const ip = req.headers.get("x-forwarded-for") || "local";
  if (!rateLimit(ip)) {
    return new Response(JSON.stringify({ error: "rate limited" }), { status: 429 });
  }
  let body;
  try { body = await req.json(); } catch (_) {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  if (!payloadOk(JSON.stringify(body).length)) {
    return new Response(JSON.stringify({ error: "payload too large" }), { status: 413 });
  }

  // ---- create room ----
  if (body.op === "create") {
    const rid = genId();
    const key = genToken();
    await saveRoom(rid, { countries: {}, realms: {}, rev: 0, members: [] });
    storeToken(rid, key);
    return new Response(JSON.stringify({ id: rid, key }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const room = await loadRoom(id);
  if (!room) return new Response(JSON.stringify({ error: "room not found" }), { status: 404 });

  // ---- heartbeat / presence ----
  if (body.op === "heartbeat") {
    const members = room.members || [];
    const entry = { id: body.cid || ip, name: body.name || "anon", color: body.color || "#6c8cff", ts: Date.now() };
    const i = members.findIndex((m) => m.id === entry.id);
    if (i >= 0) members[i] = entry; else members.push(entry);
    room.members = members.filter((m) => Date.now() - m.ts < 15000);
    await saveRoom(id, room);
    return new Response(JSON.stringify({ ok: true, members: room.members }), { status: 200 });
  }

  // ---- patch (write, token required) ----
  if (body.op === "patch") {
    if (!checkToken(id, body.token)) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
    const ok = applyPatch(room, body.patch || {});
    if (!ok) return new Response(JSON.stringify({ error: "rejected (stale)" }), { status: 409 });
    room.rev = (room.rev || 0) + 1;
    await saveRoom(id, room);
    return new Response(JSON.stringify({ ok: true, rev: room.rev }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: "unknown op" }), { status: 400 });
}
