// Minimal KV helper. Lazily imports @vercel/kv only when KV is bound.
// No top-level await (incompatible with some Vercel build output formats).
let kvPromise = null;
function getKv() {
  if (kvPromise) return kvPromise;
  kvPromise = (async () => {
    if (!process.env.KV_REST_API_URL) return null;
    try { const mod = await import("@vercel/kv"); return mod.kv || null; }
    catch (_) { return null; }
  })();
  return kvPromise;
}

export async function kvGet(k) {
  const kv = await getKv();
  if (!kv) return null;
  try { return await kv.get(k); } catch (_) { return null; }
}
export async function kvSet(k, v) {
  const kv = await getKv();
  if (!kv) return;
  try { await kv.set(k, v); } catch (_) {}
}
