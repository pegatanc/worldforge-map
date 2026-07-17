// KV helper — currently a no-op so the function has zero external deps and
// runs on both Edge and Node runtimes. Rooms persist in-memory per instance
// (see store.js MEM map). To enable durable KV, bind Vercel KV / Upstash Redis
// and replace these with real client calls.
export async function kvGet() { return null; }
export async function kvSet() {}
