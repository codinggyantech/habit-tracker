/* Habit Tracker - Phase 1 (solo, static, data stored in this browser, JSON export/import) */
"use strict";

// ---------------------------------------------------------------- constants
const STORE_KEY = "habitTracker.v1";
const CATEGORIES = {
  health:       { label: "Health",       icon: "💪", color: "#16a34a" },
  productivity: { label: "Productivity", icon: "⚡", color: "#4f46e5" },
  work:         { label: "Work",         icon: "💼", color: "#0284c7" },
  learning:     { label: "Learning",     icon: "📚", color: "#d97706" },
  mind:         { label: "Mind",         icon: "🧘", color: "#9333ea" },
  wealth:       { label: "Wealth",       icon: "💰", color: "#ca8a04" },
  other:        { label: "Other",        icon: "✨", color: "#db2777" },
};
const ICONS = ["💪","🏃","🧘","📚","💧","😴","🥗","💼","⚡","🎯","🧠","💰","✍️","🎨","🎵","🚴","🏊","🌱","📵","🙏"];
const TYPES = {
  total: "Total amount",
  times: "Number of times",
  daily: "Daily habit",
};

// ---------------------------------------------------------------- state
let state = loadState();
let tab = "today";
let openDetailId = null;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && Array.isArray(s.goals) && Array.isArray(s.logs)) return s;
  } catch (e) { /* ignore */ }
  return { goals: [], logs: [] };
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------------------------------------------------------------- dates (all local, "YYYY-MM-DD")
const DAY = 86400000;
const iso = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const todayStr = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / DAY);
const shortDate = (s) => parse(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmt = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

// ---------------------------------------------------------------- goal maths
function goalStats(g) {
  const byDate = {};
  let sum = 0;
  for (const l of state.logs) {
    if (l.goalId !== g.id) continue;
    byDate[l.date] = (byDate[l.date] || 0) + l.amount;
    sum += l.amount;
  }
  const target = g.type === "daily" ? g.days : g.target;
  const done = g.type === "daily" ? Object.values(byDate).filter((v) => v > 0).length : sum;
  const t = todayStr();
  const end = addDays(g.start, g.days - 1);
  const started = t >= g.start;
  const ended = t > end;
  const elapsed = !started ? 0 : Math.min(g.days, diffDays(g.start, t) + 1);
  const daysLeft = ended ? 0 : !started ? g.days : diffDays(t, end) + 1;
  const pct = target > 0 ? Math.min(1, done / target) : 0;
  const expected = (target * elapsed) / g.days;
  const delta = done - expected;
  const remaining = Math.max(0, target - done);
  const needPerDay = daysLeft > 0 ? remaining / daysLeft : remaining;
  const todayAmt = byDate[t] || 0;
  const maxDay = Math.max(1, ...Object.values(byDate));

  let status;
  if (done >= target) status = { cls: "done", text: "Completed 🎉" };
  else if (!started) status = { cls: "idle", text: `Starts in ${diffDays(t, g.start)}d` };
  else if (ended) status = { cls: "behind", text: `Ended · ${fmt(remaining)} short` };
  else if (delta >= 1) status = { cls: "ahead", text: `Ahead by ${fmt(Math.floor(delta))}` };
  else if (delta > -1) status = { cls: "on", text: "On track" };
  else status = { cls: "behind", text: `Behind by ${fmt(Math.ceil(-delta))}` };

  return { byDate, target, done, end, started, ended, elapsed, daysLeft, pct, expected, delta,
           remaining, needPerDay, todayAmt, maxDay, status, streak: streakOf(byDate) };
}

function streakOf(byDate) {
  const active = (d) => (byDate[d] || 0) > 0;
  let d = todayStr();
  if (!active(d)) d = addDays(d, -1);
  let n = 0;
  while (active(d)) { n++; d = addDays(d, -1); }
  return n;
}
function unitOf(g) { return g.type === "daily" ? "days" : (g.unit || (g.type === "times" ? "times" : "")); }
function progressText(g, s) { return `${fmt(s.done)} / ${fmt(s.target)} ${unitOf(g)}`.trim(); }
function colorOf(g) { return CATEGORIES[g.cat]?.color || "#4f46e5"; }
const isActive = (g, s = goalStats(g)) => s.started && !s.ended;

function addLog(goalId, amount, date = todayStr()) {
  const log = { id: uid(), goalId, date, amount, ts: Date.now() };
  state.logs.push(log);
  save();
  return log;
}
function removeLog(id) { state.logs = state.logs.filter((l) => l.id !== id); save(); }

// ---------------------------------------------------------------- tiny SVG helpers
function ring(pct, size, stroke, color, label, sub, big = false) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  return `<div class="ring ${big ? "big" : ""}" style="--c:${color};width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="rbg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="rfg" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
    </svg><span class="rlabel">${label}</span>${sub ? `<span class="rsub">${sub}</span>` : ""}</div>`;
}

function paceChart(g, s) {
  const W = 320, H = 150, p = { l: 30, r: 10, t: 10, b: 22 };
  const iw = W - p.l - p.r, ih = H - p.t - p.b, n = g.days, T = s.target || 1;
  const x = (i) => p.l + iw * (i / n);
  const y = (v) => p.t + ih * (1 - Math.min(v, T) / T);
  const pts = [[0, 0]];
  let cum = 0;
  for (let i = 1; i <= s.elapsed; i++) {
    const v = s.byDate[addDays(g.start, i - 1)] || 0;
    cum += g.type === "daily" ? (v > 0 ? 1 : 0) : v;
    pts.push([i, cum]);
  }
  const line = pts.map(([i, v], k) => `${k ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const area = `${line} L${x(last[0]).toFixed(1)} ${y(0)} L${x(0)} ${y(0)} Z`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" style="--c:${colorOf(g)}" role="img" aria-label="Progress vs pace">
    <line class="grid" x1="${p.l}" x2="${W - p.r}" y1="${y(0)}" y2="${y(0)}"/>
    <line class="grid" x1="${p.l}" x2="${W - p.r}" y1="${y(T / 2)}" y2="${y(T / 2)}"/>
    <line class="grid" x1="${p.l}" x2="${W - p.r}" y1="${y(T)}" y2="${y(T)}"/>
    <text x="${p.l - 5}" y="${y(0) + 3}" text-anchor="end">0</text>
    <text x="${p.l - 5}" y="${y(T / 2) + 3}" text-anchor="end">${fmt(T / 2)}</text>
    <text x="${p.l - 5}" y="${y(T) + 3}" text-anchor="end">${fmt(T)}</text>
    <text x="${p.l}" y="${H - 5}">${shortDate(g.start)}</text>
    <text x="${W - p.r}" y="${H - 5}" text-anchor="end">${shortDate(s.end)}</text>
    <line class="ideal" x1="${x(0)}" y1="${y(0)}" x2="${x(n)}" y2="${y(T)}"/>
    <path class="area" d="${area}"/>
    <path class="actual" d="${line}"/>
    <circle cx="${x(last[0])}" cy="${y(last[1])}" r="4.5" fill="${colorOf(g)}"/>
  </svg>
  <div class="legend" style="--c:${colorOf(g)}"><span><i></i>You</span><span><i class="dash"></i>Pace needed to finish on time</span></div>`;
}

function heatmap(g, s) {
  const t = todayStr();
  const lead = (parse(g.start).getDay() + 6) % 7; // Monday first
  let html = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="dow">${d}</div>`).join("");
  html += '<div class="cell empty"></div>'.repeat(lead);
  for (let i = 0; i < g.days; i++) {
    const d = addDays(g.start, i), v = s.byDate[d] || 0;
    const lvl = v <= 0 ? 0 : g.type === "daily" ? 4 : Math.max(1, Math.ceil((4 * v) / s.maxDay));
    html += `<div class="cell ${lvl ? "l" + lvl : ""} ${d > t ? "future" : ""} ${d === t ? "today" : ""}" title="${d}: ${fmt(v)}">${parse(d).getDate()}</div>`;
  }
  return `<div class="heat" style="--c:${colorOf(g)}">${html}</div>`;
}

// ---------------------------------------------------------------- rendering: tabs
const view = $("#view"), titleEl = $("#title");

function render() {
  $$(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  titleEl.textContent = { today: "Today", goals: "My goals", insights: "Insights", backup: "Backup" }[tab];
  view.innerHTML = { today: renderToday, goals: renderGoals, insights: renderInsights, backup: renderBackup }[tab]();
  if (openDetailId) refreshDetail();
}

function emptyState() {
  return `<div class="card empty"><div class="big">🌱</div><h2>Start your first goal</h2>
    <p>Example: "500 push-ups in 60 days" - then tap <b>+20</b> each time you do some.</p>
    <div class="btn-row"><button class="btn-primary" data-act="new">Create a goal</button>
    <button class="btn-ghost" data-act="sample">Try with sample data</button></div></div>`;
}

function goalCard(g) {
  const s = goalStats(g), c = colorOf(g);
  const cat = CATEGORIES[g.cat] || CATEGORIES.other;
  let action;
  if (g.type === "daily") {
    const done = s.todayAmt > 0;
    action = `<button class="quick ${done ? "done" : ""}" data-act="toggle" data-id="${g.id}" aria-label="Toggle today">${done ? "✓ Done" : "Mark done"}</button>`;
  } else if (g.type === "times") {
    action = `<button class="quick" style="--c:${c}" data-act="add" data-id="${g.id}" data-amt="1">+1</button>
              <button class="more" data-act="custom" data-id="${g.id}">custom</button>`;
  } else {
    action = `<button class="quick" style="--c:${c}" data-act="add" data-id="${g.id}" data-amt="${g.step || 1}">+${fmt(g.step || 1)}</button>
              <button class="more" data-act="custom" data-id="${g.id}">custom</button>`;
  }
  const todayLine = g.type === "daily"
    ? `🔥 ${s.streak} day streak`
    : `Today: <b>${fmt(s.todayAmt)}</b> · need ~${fmt(Math.ceil(s.needPerDay * 10) / 10)}/day`;
  return `<div class="card goal">
    ${ring(s.pct, 62, 8, c, Math.floor(s.pct * 100) + "%")}
    <div class="main" data-act="open" data-id="${g.id}">
      <div class="name">${esc(g.icon)} ${esc(g.name)} <span class="vis" title="${g.vis}">${g.vis === "public" ? "🌐" : "🔒"}</span></div>
      <div class="sub">${esc(progressText(g, s))}</div>
      <div class="sub">${todayLine}</div>
      <span class="chip ${s.status.cls}">${s.status.text}</span>
    </div>
    <div class="actions">${action}</div></div>`;
}

function renderToday() {
  if (!state.goals.length) return emptyState();
  const act = state.goals.filter((g) => isActive(g));
  const touched = act.filter((g) => goalStats(g).todayAmt > 0).length;
  const d = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  let html = `<div class="card banner"><h2>${d}</h2>
    <p>${act.length ? `${touched} of ${act.length} goals logged today` : "No active goals today"}</p>
    <div class="bar"><i style="width:${act.length ? (touched / act.length) * 100 : 0}%"></i></div></div>`;
  for (const [key, cat] of Object.entries(CATEGORIES)) {
    const list = act.filter((g) => g.cat === key);
    if (!list.length) continue;
    html += `<div class="section-title">${cat.icon} ${cat.label}</div>` + list.map(goalCard).join("");
  }
  const upcoming = state.goals.filter((g) => !isActive(g));
  if (upcoming.length) html += `<p class="hint" style="text-align:center">${upcoming.length} goal(s) not active today - see the Goals tab.</p>`;
  return html;
}

function renderGoals() {
  if (!state.goals.length) return emptyState();
  const groups = [
    ["Active", state.goals.filter((g) => isActive(g))],
    ["Upcoming", state.goals.filter((g) => !goalStats(g).started)],
    ["Finished", state.goals.filter((g) => goalStats(g).ended)],
  ];
  let html = "";
  for (const [label, list] of groups) {
    if (!list.length) continue;
    html += `<div class="section-title">${label} (${list.length})</div>`;
    html += list.map((g) => {
      const s = goalStats(g), c = colorOf(g);
      return `<div class="card goal" data-act="open" data-id="${g.id}" style="cursor:pointer">
        ${ring(s.pct, 54, 7, c, Math.floor(s.pct * 100) + "%")}
        <div class="main"><div class="name">${esc(g.icon)} ${esc(g.name)} <span class="vis">${g.vis === "public" ? "🌐" : "🔒"}</span></div>
        <div class="sub">${esc(progressText(g, s))} · ${TYPES[g.type]}</div>
        <div class="bar dark" style="--c:${c};margin-top:8px"><i style="width:${s.pct * 100}%"></i></div></div></div>`;
    }).join("");
  }
  return html;
}

function renderInsights() {
  if (!state.goals.length) return emptyState();
  // last 14 days: how many goals were logged
  const t = todayStr(), days = [];
  for (let i = 13; i >= 0; i--) {
    const d = addDays(t, -i);
    const n = new Set(state.logs.filter((l) => l.date === d && l.amount > 0).map((l) => l.goalId)).size;
    days.push({ d, n });
  }
  const max = Math.max(1, ...days.map((x) => x.n));
  const bars = days.map((x) => `<div class="b ${x.n ? "" : "zero"}" title="${x.d}"><span>${x.n || ""}</span>
    <i style="height:${(x.n / max) * 80}%"></i><span>${parse(x.d).getDate()}</span></div>`).join("");

  // overall streak (any goal logged)
  const any = {}; state.logs.forEach((l) => { if (l.amount > 0) any[l.date] = 1; });
  const overall = streakOf(any);

  const cats = Object.entries(CATEGORIES).map(([k, c]) => {
    const list = state.goals.filter((g) => g.cat === k);
    if (!list.length) return "";
    const avg = list.reduce((a, g) => a + goalStats(g).pct, 0) / list.length;
    return `<div class="catrow"><div class="lab">${c.icon} ${c.label}</div>
      <div class="bar dark" style="--c:${c.color}"><i style="width:${avg * 100}%"></i></div><div class="pc">${Math.round(avg * 100)}%</div></div>`;
  }).join("");

  const total = state.goals.length;
  const completed = state.goals.filter((g) => goalStats(g).status.cls === "done").length;
  const behind = state.goals.filter((g) => goalStats(g).status.cls === "behind").length;
  return `<div class="card"><div class="stats">
      <div class="stat"><b>🔥 ${overall}</b><span>day streak (any goal)</span></div>
      <div class="stat"><b>${completed}/${total}</b><span>goals completed</span></div>
      <div class="stat"><b>${state.logs.length}</b><span>total logs</span></div>
      <div class="stat"><b>${behind}</b><span>goals behind pace</span></div></div></div>
    <div class="card"><h3 class="h">Goals logged per day (last 14 days)</h3><div class="bars">${bars}</div></div>
    <div class="card"><h3 class="h">Average progress by category</h3>${cats}</div>`;
}

function renderBackup() {
  return `<div class="card"><h3 class="h">Your data lives on this device</h3>
    <p class="hint">Nothing is uploaded anywhere. Export a backup file now and then (or before clearing your browser data). Use Import to restore it, or to move to another phone.</p>
    <div class="btn-row"><button class="btn-primary" data-act="export">⬇ Export backup (JSON)</button>
    <label class="btn-ghost" style="text-align:center;cursor:pointer">⬆ Import backup<input id="importFile" type="file" accept="application/json" hidden></label></div></div>
    <div class="card"><h3 class="h">Try it out</h3>
    <p class="hint">Loads 4 sample goals with some history so you can see the charts. It adds to your data; it does not replace it.</p>
    <div class="btn-row"><button class="btn-ghost" data-act="sample">Load sample data</button></div></div>
    <div class="card"><h3 class="h">Danger zone</h3>
    <p class="hint">Deletes all goals and logs from this device. Export first if unsure.</p>
    <div class="btn-row"><button class="btn-danger" data-act="wipe">Delete everything</button></div></div>
    <p class="hint" style="text-align:center">Phase 1 · solo mode · ${state.goals.length} goals · ${state.logs.length} logs</p>`;
}

// ---------------------------------------------------------------- sheet (modal)
const sheet = $("#sheet"), sheetBody = $("#sheetBody");
function openSheet(html) {
  sheetBody.innerHTML = html;
  sheet.classList.add("open"); sheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("noscroll");
  sheet.querySelector(".sheet-panel").scrollTop = 0;
}
function closeSheet() {
  sheet.classList.remove("open"); sheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("noscroll");
  openDetailId = null;
}

// ---------------------------------------------------------------- goal detail
function showDetail(id) { openDetailId = id; refreshDetail(true); }
function refreshDetail(first) {
  const g = state.goals.find((x) => x.id === openDetailId);
  if (!g) { closeSheet(); return; }
  const s = goalStats(g), c = colorOf(g), cat = CATEGORIES[g.cat] || CATEGORIES.other;
  const logs = state.logs.filter((l) => l.goalId === g.id).sort((a, b) => b.date.localeCompare(a.date) || b.ts - a.ts).slice(0, 12);
  const html = `
    <div class="detail-head"><div class="emoji">${esc(g.icon)}</div>
      <div><h2>${esc(g.name)}</h2><p>${cat.icon} ${cat.label} · ${TYPES[g.type]} · ${g.vis === "public" ? "🌐 public" : "🔒 private"}</p></div></div>
    <div class="card hero">
      ${ring(s.pct, 128, 14, c, Math.floor(s.pct * 100) + "%", "complete", true)}
      <div><div class="stat" style="margin-bottom:8px"><b>${esc(progressText(g, s))}</b><span>progress</span></div>
      <span class="chip ${s.status.cls}" style="margin:0">${s.status.text}</span></div></div>
    <div class="card"><div class="stats">
      <div class="stat"><b>${fmt(s.remaining)}</b><span>remaining</span></div>
      <div class="stat"><b>${fmt(Math.ceil(s.needPerDay * 10) / 10)}</b><span>needed per day</span></div>
      <div class="stat"><b>${s.daysLeft}</b><span>days left (ends ${shortDate(s.end)})</span></div>
      <div class="stat"><b>🔥 ${s.streak}</b><span>day streak</span></div></div></div>
    <div class="card"><h3 class="h">Progress vs pace</h3>${paceChart(g, s)}</div>
    <div class="card"><h3 class="h">Calendar</h3>${heatmap(g, s)}</div>
    <div class="card"><h3 class="h">Log for a day</h3>
      <form id="logForm" class="row">
        <label class="f" style="margin:0">Date<input type="date" name="date" value="${todayStr()}" min="${g.start}" required></label>
        ${g.type === "daily" ? "" : `<label class="f" style="margin:0">Amount<input type="number" name="amount" step="any" min="0.01" value="${g.step || 1}" required></label>`}
        <button class="btn-primary" type="submit">${g.type === "daily" ? "Mark done" : "Add"}</button></form></div>
    <div class="card"><h3 class="h">Recent logs</h3>
      ${logs.length ? `<ul class="loglist">${logs.map((l) => `<li><span>${shortDate(l.date)} · <b>${g.type === "daily" ? "done" : "+" + fmt(l.amount)}</b></span>
        <button class="x" data-act="dellog" data-id="${l.id}" aria-label="Delete log">✕</button></li>`).join("")}</ul>` : `<p class="hint">Nothing logged yet.</p>`}</div>
    <div class="btn-row"><button class="btn-ghost" data-act="edit" data-id="${g.id}">✏️ Edit goal</button>
      <button class="btn-danger" data-act="delete" data-id="${g.id}">🗑 Delete</button></div>`;
  if (first) openSheet(html);
  else { const st = sheet.querySelector(".sheet-panel").scrollTop; sheetBody.innerHTML = html; sheet.querySelector(".sheet-panel").scrollTop = st; }
}

// ---------------------------------------------------------------- forms
function goalForm(g) {
  const edit = !!g;
  const v = g || { name: "", cat: "health", icon: "💪", type: "total", target: 500, unit: "push-ups", step: 20, days: 60, start: todayStr(), vis: "private" };
  const html = `<h2 style="margin:6px 0 0">${edit ? "Edit goal" : "New goal"}</h2>
  <form id="goalForm">
    <label class="f">Goal name<input name="name" required maxlength="60" value="${esc(v.name)}" placeholder="e.g. Push-ups"></label>
    <label class="f">What kind of goal?</label>
    <div class="seg">
      ${Object.entries(TYPES).map(([k, t]) => `<label><input type="radio" name="type" value="${k}" ${v.type === k ? "checked" : ""}><span>${t}</span></label>`).join("")}
    </div>
    <p class="hint" id="typeHint"></p>
    <div id="targetRow" class="two">
      <label class="f">Target<input name="target" type="number" step="any" min="1" value="${v.target || ""}"></label>
      <label class="f" id="unitWrap">Unit<input name="unit" maxlength="20" value="${esc(v.unit || "")}" placeholder="push-ups"></label>
    </div>
    <label class="f" id="stepWrap">Quick-add amount (the button on Today)<input name="step" type="number" step="any" min="0.01" value="${v.step || 1}"></label>
    <div class="two">
      <label class="f">Duration (days)<input name="days" type="number" min="1" max="730" value="${v.days}" required></label>
      <label class="f">Start date<input name="start" type="date" value="${v.start}" required></label>
    </div>
    <label class="f">Category
      <select name="cat">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${v.cat === k ? "selected" : ""}>${c.icon} ${c.label}</option>`).join("")}</select></label>
    <label class="f">Icon</label>
    <div class="icons">${ICONS.map((i) => `<label><input type="radio" name="icon" value="${i}" ${v.icon === i ? "checked" : ""}>${i}</label>`).join("")}</div>
    <label class="f">Who can see this goal? (sharing comes in Phase 2)
      <select name="vis"><option value="private" ${v.vis === "private" ? "selected" : ""}>🔒 Private - only me</option>
      <option value="public" ${v.vis === "public" ? "selected" : ""}>🌐 Public - friends can see</option></select></label>
    <div class="btn-row"><button class="btn-primary" type="submit">${edit ? "Save changes" : "Create goal"}</button></div>
  </form>`;
  openSheet(html);
  const form = $("#goalForm");
  const syncType = () => {
    const t = form.type.value;
    $("#targetRow").style.display = t === "daily" ? "none" : "grid";
    $("#stepWrap").style.display = t === "total" ? "block" : "none";
    $("#unitWrap").style.display = t === "total" ? "block" : "none";
    $("#typeHint").textContent = {
      total: "Add up an amount over time, like 500 push-ups or 100 km. You choose how much to add each tap.",
      times: "Count how many times you did something, like 11 workouts. Each tap adds 1.",
      daily: "Do it once every day. The target is simply every day of the duration.",
    }[t];
  };
  form.addEventListener("change", syncType); syncType();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(form), type = f.get("type");
    const goal = {
      id: g ? g.id : uid(), name: f.get("name").trim(), type,
      target: type === "daily" ? 0 : Number(f.get("target")) || 1,
      unit: type === "total" ? f.get("unit").trim() : type === "times" ? "times" : "",
      step: type === "total" ? Number(f.get("step")) || 1 : 1,
      days: Math.max(1, Math.round(Number(f.get("days")))), start: f.get("start"),
      cat: f.get("cat"), icon: f.get("icon") || "🎯", vis: f.get("vis"),
    };
    if (edit) state.goals = state.goals.map((x) => (x.id === goal.id ? goal : x)); else state.goals.push(goal);
    save(); closeSheet(); render();
    toast(edit ? "Goal updated" : "Goal created 🎯");
  });
}

function customAmount(id) {
  const g = state.goals.find((x) => x.id === id); if (!g) return;
  openSheet(`<h2 style="margin:6px 0 0">${esc(g.icon)} ${esc(g.name)}</h2><p class="hint">How much did you just do?</p>
    <form id="amtForm"><input class="big-input" name="amount" type="number" step="any" min="0.01" inputmode="decimal" value="${g.step || 1}" required style="width:100%;padding:14px;border-radius:14px;border:1px solid var(--line);background:var(--card)">
    <div class="stepper">${[1, 5, 10, 25, 50].map((n) => `<button type="button" data-fill="${n}">${n}</button>`).join("")}</div>
    <div class="btn-row"><button class="btn-primary" type="submit">Add ${esc(unitOf(g))}</button></div></form>`);
  const f = $("#amtForm");
  f.addEventListener("click", (e) => { const b = e.target.closest("[data-fill]"); if (b) f.amount.value = b.dataset.fill; });
  f.addEventListener("submit", (e) => { e.preventDefault(); closeSheet(); logAndToast(id, Number(f.amount.value)); });
  setTimeout(() => f.amount.select(), 250);
}

// ---------------------------------------------------------------- actions
let toastTimer;
function toast(msg, undoFn) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${undoFn ? `<button id="undoBtn">Undo</button>` : ""}`;
  el.classList.add("show");
  if (undoFn) $("#undoBtn").onclick = () => { undoFn(); el.classList.remove("show"); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), undoFn ? 4500 : 2200);
}

function logAndToast(id, amount, date) {
  const g = state.goals.find((x) => x.id === id); if (!g || !(amount > 0)) return;
  const before = goalStats(g).status.cls;
  const log = addLog(id, amount, date);
  const s = goalStats(g);
  render();
  const msg = s.status.cls === "done" && before !== "done"
    ? `🎉 "${g.name}" completed!`
    : g.type === "daily" ? "Done for today ✓"
    : `+${fmt(amount)} ${unitOf(g)} · ${Math.floor(s.pct * 100)}% complete`;
  toast(msg, () => { removeLog(log.id); render(); });
}

document.addEventListener("click", (e) => {
  const tabBtn = e.target.closest("[data-tab]");
  if (tabBtn) { tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest("[data-act]"); if (!el) return;
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case "new": goalForm(); break;
    case "close": closeSheet(); break;
    case "open": showDetail(id); break;
    case "add": logAndToast(id, Number(el.dataset.amt)); break;
    case "custom": customAmount(id); break;
    case "toggle": {
      const t = todayStr(), mine = state.logs.filter((l) => l.goalId === id && l.date === t);
      if (mine.length) { state.logs = state.logs.filter((l) => !(l.goalId === id && l.date === t)); save(); render(); toast("Unmarked for today"); }
      else logAndToast(id, 1);
      break;
    }
    case "edit": { const g = state.goals.find((x) => x.id === id); if (g) { openDetailId = null; goalForm(g); } break; }
    case "delete": {
      const g = state.goals.find((x) => x.id === id);
      if (g && confirm(`Delete "${g.name}" and all its logs?`)) {
        state.goals = state.goals.filter((x) => x.id !== id);
        state.logs = state.logs.filter((l) => l.goalId !== id);
        save(); closeSheet(); render(); toast("Goal deleted");
      }
      break;
    }
    case "dellog": removeLog(id); render(); break;
    case "export": exportData(); break;
    case "sample": loadSample(); break;
    case "wipe":
      if (confirm("Delete ALL goals and logs on this device? This cannot be undone.")) { state = { goals: [], logs: [] }; save(); render(); toast("Everything deleted"); }
      break;
  }
});

document.addEventListener("submit", (e) => {
  if (e.target.id !== "logForm") return;
  e.preventDefault();
  const f = new FormData(e.target), g = state.goals.find((x) => x.id === openDetailId);
  if (!g) return;
  const date = f.get("date");
  if (g.type === "daily") {
    if (state.logs.some((l) => l.goalId === g.id && l.date === date)) { toast("Already marked for that day"); return; }
    addLog(g.id, 1, date);
  } else addLog(g.id, Number(f.get("amount")), date);
  render(); toast("Logged ✓");
});

document.addEventListener("change", (e) => {
  if (e.target.id !== "importFile") return;
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.goals) || !Array.isArray(data.logs)) throw new Error("bad file");
      if (!confirm(`Import ${data.goals.length} goals and ${data.logs.length} logs? This replaces your current data.`)) return;
      state = { goals: data.goals, logs: data.logs }; save(); render(); toast("Backup imported ✓");
    } catch (err) { toast("That file is not a valid backup"); }
  };
  reader.readAsText(file);
});

function exportData() {
  const blob = new Blob([JSON.stringify({ app: "habit-tracker", version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `habit-tracker-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast("Backup downloaded");
}

function loadSample() {
  const start = addDays(todayStr(), -20);
  const mk = (o) => ({ id: uid(), unit: "", step: 1, target: 0, days: 60, start, vis: "private", ...o });
  const goals = [
    mk({ name: "Push-ups", icon: "💪", cat: "health", type: "total", target: 500, unit: "push-ups", step: 20, vis: "public" }),
    mk({ name: "Workouts", icon: "🏃", cat: "health", type: "times", target: 24, unit: "times" }),
    mk({ name: "Read 20 pages", icon: "📚", cat: "learning", type: "daily", vis: "public" }),
    mk({ name: "Deep work hours", icon: "⚡", cat: "productivity", type: "total", target: 80, unit: "hours", step: 1 }),
  ];
  const logs = [];
  const put = (g, i, amt) => logs.push({ id: uid(), goalId: g.id, date: addDays(start, i), amount: amt, ts: Date.now() + logs.length });
  for (let i = 0; i <= 20; i++) {
    if (i % 3 !== 2) put(goals[0], i, [20, 25, 15, 30][i % 4]);
    if (i % 3 === 0) put(goals[1], i, 1);
    if (i % 5 !== 3) put(goals[2], i, 1);
    if (i % 7 < 5) put(goals[3], i, [1, 2, 1.5, 2.5][i % 4]);
  }
  state.goals.push(...goals); state.logs.push(...logs);
  save(); tab = "today"; render(); toast("Sample data loaded");
}

// ---------------------------------------------------------------- boot
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
render();
// refresh when the date changes while the app stays open
let lastDay = todayStr();
document.addEventListener("visibilitychange", () => { if (!document.hidden && todayStr() !== lastDay) { lastDay = todayStr(); render(); } });
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
