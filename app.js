/* ============================================================
   WORLDFORGE — interactive lore map
   - D3 + topojson, fully offline
   - per-country: lore, color, flag (dataURL/url)
   - realms: shift+click to bind countries into a shared realm
   - persistence in localStorage; JSON export/import
   ============================================================ */
(function () {
  "use strict";

  const STORE_KEY = "worldforge_state_v1";
  const MAP_URL = "countries-110m.json";

  // ---- state ----
  const state = {
    countries: {},   // id -> {name, lore, color, flag}
    realms: {},      // realmId -> {name, color, members:[ids], lore}
    selected: null,  // current country id
    pendingRealm: [],// countries staged for a new realm (shift-click)
  };

  // ---- d3 setup ----
  const svg = d3.select("#map");
  let gMap, gBonds, gCountries, gLabels;
  let projection, path, zoom, currentTransform = d3.zoomIdentity;

  // ---- persistence ----
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        countries: state.countries,
        realms: state.realms,
      }));
    } catch (e) { console.warn("save failed", e); }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      state.countries = d.countries || {};
      state.realms = d.realms || {};
    } catch (e) { console.warn("load failed", e); }
  }

  // ---- toast ----
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  // ---- color helpers ----
  const DEFAULT_FILL = "#1c2740";
  function countryFill(d) {
    const id = d.id;
    const c = state.countries[id];
    if (c && c.color) return c.color;
    // if in a realm, use realm color
    const rid = realmOf(id);
    if (rid && state.realms[rid].color) return state.realms[rid].color;
    return DEFAULT_FILL;
  }
  function realmOf(id) {
    for (const rid in state.realms) {
      if (state.realms[rid].members.includes(id)) return rid;
    }
    return null;
  }

  // ---- geometry adjacency (shared borders via shared arcs) ----
  // Built from topojson: two countries share a border if they reference
  // the same arc (or reversed arc). We compute this to optionally auto-suggest.
  let adjacency = {}; // id -> Set(ids)

  function buildAdjacency(topology, countries) {
    // map arc index -> list of country ids using it
    const arcUsers = {};
    countries.forEach((geom) => {
      const arcs = geom.arcs || [];
      const flat = [];
      (Array.isArray(arcs[0]) ? arcs : [arcs]).forEach((poly) => {
        poly.forEach((ai) => {
          const norm = ai < 0 ? ~ai : ai;
          flat.push(norm);
        });
      });
      flat.forEach((ai) => {
        (arcUsers[ai] = arcUsers[ai] || new Set()).add(geom.id);
      });
    });
    const adj = {};
    Object.values(arcUsers).forEach((set) => {
      const ids = [...set];
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          (adj[ids[i]] = adj[ids[i]] || new Set()).add(ids[j]);
          (adj[ids[j]] = adj[ids[j]] || new Set()).add(ids[i]);
        }
      }
    });
    adjacency = adj;
  }

  // ---- render ----
  function render() {
    gCountries.selectAll("path.country")
      .attr("fill", countryFill)
      .classed("selected", (d) => d.id === state.selected);
    drawBonds();
  }

  // draw dashed bonds between realm members that are adjacent
  function drawBonds() {
    gBonds.selectAll("*").remove();
    for (const rid in state.realms) {
      const m = state.realms[rid].members;
      for (let i = 0; i < m.length; i++) {
        for (let j = i + 1; j < m.length; j++) {
          if (adjacency[m[i]] && adjacency[m[i]].has(m[j])) {
            // outline both countries' borders to show the bond
            [m[i], m[j]].forEach((id) => {
              const feat = countryFeature(id);
              if (feat) {
                gBonds.append("path")
                  .attr("class", "realm-bond")
                  .attr("d", path(feat))
                  .attr("transform", currentTransform.toString());
              }
            });
          }
        }
      }
    }
  }

  let FEATURES = [];
  const featureById = {};
  function countryFeature(id) { return featureById[id]; }

  // ---- panel ----
  function openPanel(id) {
    state.selected = id;
    const c = state.countries[id] || (state.countries[id] = { name: nameOf(id) });
    const panel = document.getElementById("panel");
    const rid = realmOf(id);

    panel.innerHTML = `
      <div class="card">
        <h3>${escapeHtml(c.name)}</h3>
        <div class="stat">Realm: <b>${rid ? escapeHtml(state.realms[rid].name) : "— (none)"}</b></div>
        <div class="stat" style="margin-top:4px">ISO id: <b>${escapeHtml(String(id))}</b></div>
        <div class="stat" style="margin-top:4px">Neighbors: <b>${adjacency[id] ? adjacency[id].size : 0}</b></div>
      </div>

      <div class="card">
        <h3>Lore</h3>
        <textarea id="lore" placeholder="Write the history, culture, and secrets of ${escapeHtml(c.name)}…">${escapeHtml(c.lore || "")}</textarea>
      </div>

      <div class="card">
        <h3>Appearance</h3>
        <div class="row">
          <div>
            <label>Fill color</label>
            <input type="color" id="color" value="${toHex(countryFill({id}))}">
          </div>
          <div>
            <label>Reset</label>
            <button class="btn sm" id="clrColor">Clear custom</button>
          </div>
        </div>
        <div class="flagbox">
          <div id="flagPrev">${c.flag ? `<img src="${escapeHtml(c.flag)}" alt="flag">` : `<span class="stat">no flag</span>`}</div>
          <div style="flex:1">
            <label>Flag image URL</label>
            <input type="text" id="flagurl" placeholder="https://… or data:image/…" value="${c.flag && !c.flag.startsWith('data:') ? escapeHtml(c.flag) : ''}">
            <div class="flagurl"><input type="file" id="flagfile" accept="image/*" style="font-size:11px;color:var(--muted)"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Realms</h3>
        <div class="stat" style="margin-bottom:8px">Shift+click other countries on the map to stage them, then create a realm binding them together.</div>
        <div class="realm-list" id="pendingList"></div>
        <div style="margin-top:10px;display:flex;gap:8px">
          <input type="text" id="realmName" placeholder="Realm name…" style="flex:2">
          <button class="btn accent sm" id="makeRealm" style="flex:1">Bind realm</button>
        </div>
        <div class="realm-list" id="realmList" style="margin-top:10px"></div>
      </div>

      <div class="card">
        <h3>World stats</h3>
        <div class="stat">Countries with lore: <b>${Object.values(state.countries).filter(x=>x.lore&&x.lore.trim()).length}</b></div>
        <div class="stat" style="margin-top:4px">Realms: <b>${Object.keys(state.realms).length}</b></div>
        <div class="exportrow" style="margin-top:10px">
          <button class="btn sm" id="pExport">Export JSON</button>
          <button class="btn sm" id="pImport">Import JSON</button>
          <button class="btn sm" id="pClear" style="border-color:#5a2a3a;color:#ff8aa0">Clear this country</button>
        </div>
      </div>
    `;

    // wire lore
    document.getElementById("lore").addEventListener("input", (e) => {
      state.countries[id].lore = e.target.value; save();
    });
    // color
    document.getElementById("color").addEventListener("input", (e) => {
      state.countries[id].color = e.target.value; save(); render();
    });
    document.getElementById("clrColor").addEventListener("click", () => {
      delete state.countries[id].color; save(); render();
      document.getElementById("color").value = toHex(countryFill({id}));
    });
    // flag url
    document.getElementById("flagurl").addEventListener("input", (e) => {
      const v = e.target.value.trim();
      state.countries[id].flag = v || undefined; save();
      document.getElementById("flagPrev").innerHTML = v ? `<img src="${escapeHtml(v)}" alt="flag">` : `<span class="stat">no flag</span>`;
    });
    // flag file -> dataURL
    document.getElementById("flagfile").addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        state.countries[id].flag = r.result; save();
        document.getElementById("flagPrev").innerHTML = `<img src="${r.result}" alt="flag">`;
        toast("Flag uploaded");
      };
      r.readAsDataURL(f);
    });
    // pending realm staging
    renderPending();
    document.getElementById("makeRealm").addEventListener("click", () => {
      const nm = document.getElementById("realmName").value.trim() || "Realm";
      if (state.pendingRealm.length === 0) { toast("Shift+click countries to stage them first"); return; }
      const rid = "R" + Date.now().toString(36);
      state.realms[rid] = { name: nm, color: randColor(), members: [...state.pendingRealm], lore: "" };
      state.pendingRealm = [];
      save(); render(); openPanel(id); toast("Realm bound: " + nm);
    });
    // existing realms list
    renderRealmList(id);
    // panel buttons
    document.getElementById("pExport").addEventListener("click", exportJSON);
    document.getElementById("pImport").addEventListener("click", () => document.getElementById("fileInput").click());
    document.getElementById("pClear").addEventListener("click", () => {
      delete state.countries[id]; save(); render();
      document.getElementById("panel").innerHTML = `<div class="card"><div class="empty">Country cleared.</div></div>`;
      state.selected = null;
    });

    render();
  }

  function renderPending() {
    const el = document.getElementById("pendingList");
    if (!el) return;
    el.innerHTML = state.pendingRealm.length
      ? state.pendingRealm.map((pid) => `<span class="chip">${escapeHtml(nameOf(pid))}</span>`).join("")
      : `<span class="stat">none staged</span>`;
  }
  function renderRealmList(id) {
    const el = document.getElementById("realmList");
    if (!el) return;
    const my = Object.keys(state.realms).filter((r) => state.realms[r].members.includes(id));
    if (!my.length) { el.innerHTML = `<span class="stat">Not in any realm.</span>`; return; }
    el.innerHTML = my.map((rid) => {
      const r = state.realms[rid];
      return `<div class="chip" style="border-color:${r.color}">
        <span style="width:10px;height:10px;border-radius:2px;background:${r.color};display:inline-block"></span>
        ${escapeHtml(r.name)}
        <span class="x" data-rid="${rid}">✕</span></div>`;
    }).join("");
    el.querySelectorAll(".x").forEach((x) => x.addEventListener("click", () => {
      const rid = x.getAttribute("data-rid");
      state.realms[rid].members = state.realms[rid].members.filter((m) => m !== id);
      if (state.realms[rid].members.length === 0) delete state.realms[rid];
      save(); render(); openPanel(id);
    }));
  }

  function nameOf(id) {
    return (state.countries[id] && state.countries[id].name) || (featureById[id] && featureById[id].properties && featureById[id].properties.name) || String(id);
  }

  // ---- realm / stage handlers ----
  function stageForRealm(id) {
    if (!state.pendingRealm.includes(id)) state.pendingRealm.push(id);
    toast("Staged: " + nameOf(id));
    renderPending();
    // if a country panel is open, refresh staging display
  }

  // ---- export / import ----
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ countries: state.countries, realms: state.realms }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "worldforge-world.json";
    a.click();
    toast("Exported world JSON");
  }
  function importJSON(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        state.countries = Object.assign({}, state.countries, d.countries || {});
        state.realms = Object.assign({}, state.realms, d.realms || {});
        save(); render();
        if (state.selected) openPanel(state.selected);
        toast("World imported");
      } catch (e) { toast("Invalid JSON file"); }
    };
    r.readAsText(file);
  }

  // ---- utils ----
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function toHex(c) {
    if (!c) return "#1c2740";
    if (c.startsWith("#")) return c;
    // named color -> hex
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = c; return ctx.fillStyle;
  }
  function randColor() {
    const h = Math.floor(Math.random() * 360);
    return `hsl(${h},55%,55%)`;
  }

  // ---- boot ----
  async function boot() {
    load();
    const topology = await (await fetch(MAP_URL)).json();
    const countries = topojson.feature(topology, topology.objects.countries).features;
    FEATURES = countries;
    countries.forEach((f) => { featureById[f.id] = f; });

    buildAdjacency(topology, countries);

    const width = document.getElementById("mapwrap").clientWidth;
    const height = document.getElementById("mapwrap").clientHeight;
    projection = d3.geoNaturalEarth1().fitSize([width, height], topojson.feature(topology, topology.objects.countries));
    path = d3.geoPath(projection);

    svg.attr("viewBox", `0 0 ${width} ${height}`);
    gMap = svg.append("g");
    gBonds = gMap.append("g");
    gCountries = gMap.append("g");

    gCountries.selectAll("path.country")
      .data(countries)
      .join("path")
      .attr("class", "country")
      .attr("d", path)
      .attr("fill", countryFill)
      .on("click", (event, d) => {
        if (event.shiftKey) { stageForRealm(d.id); }
        else { openPanel(d.id); }
      })
      .append("title").text((d) => nameOf(d.id));

    // zoom / pan
    zoom = d3.zoom().scaleExtent([1, 12]).on("zoom", (event) => {
      currentTransform = event.transform;
      gMap.attr("transform", currentTransform);
      gCountries.selectAll("path").attr("stroke-width", 0.4 / currentTransform.k);
      gBonds.selectAll("path").attr("transform", currentTransform.toString());
    });
    svg.call(zoom);

    // search
    document.getElementById("search").addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase();
      gCountries.selectAll("path.country").attr("opacity", (d) => {
        if (!q) return 1;
        return nameOf(d.id).toLowerCase().includes(q) ? 1 : 0.12;
      });
    });
    // zoom buttons
    document.getElementById("zin").onclick = () => svg.transition().call(zoom.scaleBy, 1.6);
    document.getElementById("zout").onclick = () => svg.transition().call(zoom.scaleBy, 1 / 1.6);
    document.getElementById("zreset").onclick = () => svg.transition().call(zoom.transform, d3.zoomIdentity);

    // header buttons
    document.getElementById("btnExport").onclick = exportJSON;
    document.getElementById("btnImport").onclick = () => document.getElementById("fileInput").click();
    document.getElementById("btnReset").onclick = () => {
      if (confirm("Erase ALL lore, colors, flags, and realms?")) {
        state.countries = {}; state.realms = {}; state.selected = null; state.pendingRealm = [];
        save(); render();
        document.getElementById("panel").innerHTML = `<div class="card"><div class="empty">World reset. Start fresh.</div></div>`;
      }
    };
    document.getElementById("fileInput").addEventListener("change", (e) => {
      if (e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
    });

    window.addEventListener("resize", () => {
      const w = document.getElementById("mapwrap").clientWidth;
      const h = document.getElementById("mapwrap").clientHeight;
      svg.attr("viewBox", `0 0 ${w} ${h}`);
      projection.fitSize([w, h], topojson.feature(topology, topology.objects.countries));
      gCountries.selectAll("path.country").attr("d", path);
      drawBonds();
    });

    render();
  }

  boot().catch((err) => {
    document.getElementById("panel").innerHTML = `<div class="card"><div class="empty">Failed to load map data:<br>${escapeHtml(err.message)}</div></div>`;
    console.error(err);
  });
})();
