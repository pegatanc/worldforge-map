// Shared room store + security for Worldforge collab
// Uses Vercel KV if bound (process.env.KV_REST_API_URL + token), else in-memory.
import { kvGet, kvSet } from "./kv-helper.js";
import { webcrypto } from "node:crypto";

// Ensure a Web Crypto implementation is always available (Vercel Node runtime
// may not expose global `crypto` depending on version).
const crypto = globalThis.crypto || webcrypto;

const MEM = new Map(); // in-memory fallback (dev / no KV binding)
const KEYMAP = {};     // roomId -> secret write token

const MAX_PAYLOAD = 200 * 1024; // 200KB
const RATE = { windowMs: 60_000, max: 50 };
const hits = new Map(); // ip -> [timestamps]

export function rateLimit(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < RATE.windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length <= RATE.max;
}

export function payloadOk(len) { return len <= MAX_PAYLOAD; }

function k(id) { return "wf:room:" + id; }

export async function loadRoom(id) {
  if (process.env.KV_REST_API_URL) return (await kvGet(k(id))) || null;
  return MEM.get(id) || null;
}
export async function saveRoom(id, data) {
  if (process.env.KV_REST_API_URL) return kvSet(k(id), data);
  MEM.set(id, data);
}

export function storeToken(id, token) { KEYMAP[id] = token; }
export function checkToken(id, token) { return KEYMAP[id] === token; }

export function genId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(9)))
    .map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}
export function genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
}

// merge a patch into state with per-field last-write-wins by ts
export function applyPatch(state, patch) {
  const { id, field, value, ts, editor } = patch;
  if (!id || !field) return false;
  const c = (state.countries[id] = state.countries[id] || { name: id });
  const prev = c[field];
  if (prev && typeof prev === "object" && "_ts" in prev && ts < prev._ts) return false;
  c[field] = { v: value, _ts: ts, _by: editor || "anon" };
  return true;
}

// normalize stored country fields back to plain values for the client
export function serialize(state) {
  const out = {
    countries: {},
    realms: state.realms || {},
    rev: state.rev || 0,
    members: state.members || [],
  };
  for (const cid in state.countries) {
    const c = state.countries[cid];
    const o = {};
    for (const key in c) {
      const val = c[key];
      o[key] = val && typeof val === "object" && "_ts" in val ? val.v : val;
    }
    out.countries[cid] = o;
  }
  return out;
}
