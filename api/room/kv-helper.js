// KV helper — durable store via Upstash Redis REST (edge-compatible, plain fetch).
// Falls back to in-memory when UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
// are not set (rooms then live only in the current instance / until cold start).
const MEM = new Map();

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOK = process.env.UPSTASH_REDIS_REST_TOKEN;
const ENABLED = !!URL && !!TOK;

async function upstash(cmd, ...args) {
  const r = await fetch(`${URL}/${cmd}/${args.map(encodeURIComponent).join("/")}`, {
    headers: { Authorization: `Bearer ${TOK}` },
  });
  if (!r.ok) throw new Error("upstash " + r.status);
  const j = await r.json();
  return j.result;
}

export async function kvGet(key) {
  if (!ENABLED) return MEM.get(key) || null;
  try {
    const raw = await upstash("get", key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

export async function kvSet(key, value) {
  if (!ENABLED) { MEM.set(key, value); return; }
  try { await upstash("set", key, JSON.stringify(value)); } catch (_) {}
}
