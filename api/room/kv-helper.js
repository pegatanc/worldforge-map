// Minimal KV helper. Uses @vercel/kv when available, else no-op (callers fall back to memory).
let kv = null;
try {
  const mod = await import("@vercel/kv");
  kv = mod.kv;
} catch (_) { /* KV not installed → in-memory path in store.js */ }

export async function kvGet(k) {
  if (!kv) return null;
  try { return await kv.get(k); } catch (_) { return null; }
}
export async function kvSet(k, v) {
  if (!kv) return;
  try { await kv.set(k, v); } catch (_) {}
}
