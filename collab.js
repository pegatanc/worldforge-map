// Worldforge collaboration client
// Talks to /api/room/[id]. Read-only GET every 5s; writes via POST with room key.
const POLL_MS = 5000;

class Collab {
  constructor({ onSync, onMembers, onError } = {}) {
    this.room = null;     // room id
    this.key = null;      // write token
    this.cid = Math.random().toString(36).slice(2, 10);
    this.name = "anon";
    this.color = "#6c8cff";
    this.onSync = onSync || (() => {});
    this.onMembers = onMembers || (() => {});
    this.onError = onError || (() => {});
    this.timer = null;
    this.lastRev = -1;
  }

  // restore from URL ?room=ID&key=KEY
  static fromURL() {
    const u = new URL(location.href);
    const room = u.searchParams.get("room");
    const key = u.searchParams.get("key");
    const c = new Collab();
    if (room) { c.room = room; c.key = key; }
    return c;
  }

  shareURL() {
    if (!this.room) return null;
    const u = new URL(location.href);
    u.searchParams.set("room", this.room);
    u.searchParams.set("key", this.key || "");
    return u.toString();
  }

  async create() {
    const r = await fetch("/api/room/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "create" }),
    });
    if (!r.ok) throw new Error("create failed");
    const d = await r.json();
    this.room = d.id; this.key = d.key;
    this._start();
    return this.shareURL();
  }

  join(room, key) {
    this.room = room; this.key = key;
    this._start();
  }

  _start() {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
    // heartbeat
    this._hb = setInterval(() => this.heartbeat(), 4000);
  }

  stop() { clearInterval(this.timer); clearInterval(this._hb); this.timer = null; }

  async poll() {
    if (!this.room) return;
    try {
      const r = await fetch(`/api/room/${this.room}`, { cache: "no-store" });
      if (!r.ok) { this.onError("room not found"); return; }
      const data = await r.json();
      if (data.rev !== this.lastRev) {
        this.lastRev = data.rev;
        this.onSync(data);
      }
      if (data.members) this.onMembers(data.members);
    } catch (e) { this.onError(e.message); }
  }

  async heartbeat() {
    if (!this.room) return;
    try {
      await fetch(`/api/room/${this.room}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "heartbeat", cid: this.cid, name: this.name, color: this.color }),
      });
    } catch (_) {}
  }

  // patch a single field on a country. editor id included for presence.
  async patch(countryId, field, value) {
    if (!this.room || !this.key) return false;
    const body = {
      op: "patch", token: this.key,
      patch: { id: countryId, field, value, ts: Date.now(), editor: this.name },
    };
    const r = await fetch(`/api/room/${this.room}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.status === 401) { this.onError("unauthorized (bad key)"); return false; }
    if (r.status === 409) { this.onError("edit rejected (newer write won)"); return false; }
    return r.ok;
  }
}

// expose for app.js
if (typeof window !== "undefined") window.Worldforge = { Collab };

