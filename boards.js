/* Boards: multiple boards (Health, Wealth, Work...) with tasks, an Inbox for quick "anonymous" tasks,
   "focus today" picking, and importing a plan (JSON or CSV). Loaded BEFORE app.js; it only touches app.js globals inside functions. */
"use strict";
(function () {
  const STATUS = { todo: "To do", doing: "Doing", done: "Done" };
  const STATUS_ORDER = ["todo", "doing", "done"];
  const INBOX = { id: "inbox", name: "Inbox", icon: "📥", color: "#64748b", cat: "" };
  const BOARD_ICONS = ["💪", "🚀", "💰", "🧘", "📚", "💼", "🏠", "✈️", "🎯", "🛒", "❤️", "🎨"];
  const ui = { boardId: null, filter: "week", col: "todo" };
  let pending = null;   // a parsed plan waiting for confirmation in the import sheet

  const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && iso(parse(s)) === s;
  const prioRank = (p) => (PRIORITIES[p] ? PRIORITIES[p].rank : 1);

  /* ------------------------------------------------ standard board / task (validation shared by form, import, plan files) */
  function makeBoard(raw, cats) {
    const name = String(raw.name ?? "").trim().slice(0, 30);
    if (!name) return { errors: ["board name is required"] };
    const cat = raw.category ?? raw.cat ?? "";
    return { board: {
      id: String(raw.id || uid()), name, icon: String(raw.icon || "🗂").slice(0, 4),
      color: /^#[0-9a-f]{6}$/i.test(raw.color || "") ? raw.color : "#4f46e5",
      cat: cats && cats[cat] ? cat : "",
    } };
  }
  function makeTask(raw, boardIds) {
    const title = String(raw.title ?? "").trim().slice(0, 120);
    if (!title) return { errors: ["task title is required"] };
    const status = STATUS[raw.status] ? raw.status : "todo";
    const minutes = Math.max(0, Math.min(1440, Math.round(Number(raw.minutes) || 0)));
    return { task: {
      id: String(raw.id || uid()), boardId: boardIds.has(raw.boardId) ? raw.boardId : "inbox", title,
      notes: String(raw.notes ?? "").slice(0, 500), status, priority: PRIORITIES[raw.priority] ? raw.priority : "medium",
      due: isDateStr(raw.due) ? raw.due : "", minutes, focus: isDateStr(raw.focus) ? raw.focus : "",
      createdAt: Number(raw.createdAt) || Date.now(), doneAt: status === "done" ? (isDateStr(raw.doneAt) ? raw.doneAt : todayStr()) : "",
    } };
  }
  function normalizeBoards(rawBoards, rawTasks, cats) {
    const boards = [];
    for (const b of Array.isArray(rawBoards) ? rawBoards : []) {
      const r = makeBoard(b || {}, cats);
      if (r.board && !boards.some((x) => x.id === r.board.id)) boards.push(r.board);
    }
    const inbox = boards.find((b) => b.id === "inbox");
    if (inbox) { boards.splice(boards.indexOf(inbox), 1); }
    boards.unshift({ ...INBOX, ...(inbox ? { name: inbox.name, icon: inbox.icon, color: inbox.color } : {}) });
    const ids = new Set(boards.map((b) => b.id));
    const tasks = [];
    for (const t of Array.isArray(rawTasks) ? rawTasks : []) { const r = makeTask(t || {}, ids); if (r.task) tasks.push(r.task); }
    return { boards, tasks };
  }

  /* ------------------------------------------------ helpers */
  const boardById = (id) => state.boards.find((b) => b.id === id) || state.boards[0];
  const tasksOf = (id) => state.tasks.filter((t) => t.boardId === id);
  function stats(id) {
    const ts = tasksOf(id), t0 = todayStr();
    const done = ts.filter((t) => t.status === "done").length;
    return { total: ts.length, done, doing: ts.filter((t) => t.status === "doing").length,
      pct: ts.length ? done / ts.length : 0,
      overdue: ts.filter((t) => t.status !== "done" && t.due && t.due < t0).length,
      week: ts.filter((t) => t.status !== "done" && t.due && t.due >= t0 && t.due <= addDays(t0, 6)).length };
  }
  function dueInfo(t) {
    if (!t.due) return null;
    if (t.status === "done") return { t: shortDate(t.due), cls: "" };
    const d = diffDays(todayStr(), t.due);
    if (d < 0) return { t: `Overdue ${-d}d`, cls: "late" };
    if (d === 0) return { t: "Today", cls: "today" };
    if (d === 1) return { t: "Tomorrow", cls: "soon" };
    return { t: shortDate(t.due), cls: d <= 6 ? "soon" : "" };
  }
  const isFocus = (t) => t.focus === todayStr();
  const focusList = () => state.tasks.filter((t) => t.focus === todayStr() || t.due === todayStr())
    .sort((a, b) => (a.status === "done") - (b.status === "done") || prioRank(a.priority) - prioRank(b.priority));
  function sortTasks(list) {
    return [...list].sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || prioRank(a.priority) - prioRank(b.priority) || a.createdAt - b.createdAt);
  }
  function passes(t) {
    const t0 = todayStr();
    switch (ui.filter) {
      case "today": return t.due === t0 || t.focus === t0;
      case "week": return t.status === "done" || !t.due || t.due <= addDays(t0, 6);
      case "overdue": return t.status !== "done" && t.due && t.due < t0;
      default: return true;
    }
  }
  function setStatus(t, status) {
    t.status = status; t.doneAt = status === "done" ? todayStr() : "";
    if (status === "done" && t.focus === todayStr()) { /* stays in today's list, shown as done */ }
  }
  // Deleting a board never deletes its tasks: they move to the Inbox.
  function deleteBoard(id) {
    if (id === "inbox") return 0;
    let moved = 0;
    state.tasks.forEach((t) => { if (t.boardId === id) { t.boardId = "inbox"; moved++; } });
    state.boards = state.boards.filter((b) => b.id !== id);
    return moved;
  }
  function addTask(boardId, title, extra = {}) {
    const ids = new Set(state.boards.map((b) => b.id));
    const r = makeTask({ boardId, title, ...extra }, ids);
    if (r.errors) { toast("⚠ " + r.errors[0]); return null; }
    state.tasks.push(r.task); save(); return r.task;
  }

  /* ------------------------------------------------ views */
  function taskCard(t) {
    const di = dueInfo(t), b = boardById(t.boardId), pr = PRIORITIES[t.priority] || PRIORITIES.medium;
    return `<div class="task ${t.status}" data-id="${t.id}" style="--c:${b.color}">
      <button class="chk-btn ${t.status === "done" ? "on" : ""}" data-bd="task-toggle" data-id="${t.id}" aria-label="Mark ${t.status === "done" ? "not done" : "done"}">${t.status === "done" ? "✓" : ""}</button>
      <div class="t-main" data-bd="task-open" data-id="${t.id}">
        <div class="t-title">${esc(t.title)}</div>
        <div class="t-meta">${di ? `<span class="due ${di.cls}">${di.t}</span>` : ""}${t.minutes ? `<span>${t.minutes} min</span>` : ""}<span title="${pr.label} priority">${pr.icon}</span>${ui.boardId ? "" : `<span>${esc(b.icon)} ${esc(b.name)}</span>`}</div>
      </div>
      <div class="t-act">
        <button data-bd="task-focus" data-id="${t.id}" class="star ${isFocus(t) ? "on" : ""}" aria-label="Focus today" title="Focus today">★</button>
        <button data-bd="task-move" data-id="${t.id}" data-dir="-1" aria-label="Move back" ${t.status === "todo" ? "disabled" : ""}>◀</button>
        <button data-bd="task-move" data-id="${t.id}" data-dir="1" aria-label="Move forward" ${t.status === "done" ? "disabled" : ""}>▶</button>
      </div></div>`;
  }

  function focusBlock(compact) {
    const list = focusList(), done = list.filter((t) => t.status === "done").length;
    const rows = list.length ? list.map((t) => {
      const b = boardById(t.boardId);
      return `<div class="ft ${t.status === "done" ? "done" : ""}">
        <button class="chk-btn ${t.status === "done" ? "on" : ""}" data-bd="task-toggle" data-id="${t.id}" aria-label="Toggle done">${t.status === "done" ? "✓" : ""}</button>
        <div class="ft-main" data-bd="task-open" data-id="${t.id}"><span>${esc(t.title)}</span><small>${esc(b.icon)} ${esc(b.name)}${t.minutes ? " · " + t.minutes + " min" : ""}</small></div></div>`;
    }).join("") : `<p class="hint">Nothing picked yet. Add a quick task below or pick from your boards.</p>`;
    return `<div class="card focus-card">
      <div class="focus-head"><h3>⭐ Focus today</h3><span class="chip-lite">${done}/${list.length} done</span></div>
      <div class="bar dark" style="--c:var(--good);margin:8px 0 12px"><i style="width:${list.length ? (done / list.length) * 100 : 0}%"></i></div>
      ${rows}
      <form class="quick-add" data-quick>
        <input name="title" maxlength="120" placeholder="Quick task, no board needed" aria-label="Quick task" required>
        <button class="btn-primary small" type="submit">Add</button></form>
      <div class="btn-row"><button class="btn-ghost small" type="button" data-bd="pick">＋ Pick from my boards</button>${compact ? `<button class="btn-ghost small" type="button" data-bd="goto">Open boards</button>` : ""}</div>
    </div>`;
  }

  function overview() {
    const cards = state.boards.map((b) => {
      const s = stats(b.id);
      return `<button class="card bd-card" type="button" data-bd="board-open" data-id="${b.id}" style="--c:${b.color}">
        ${ring(s.pct, 58, 7, b.color, Math.round(s.pct * 100) + "%")}
        <div class="bd-card-main"><b>${esc(b.icon)} ${esc(b.name)}</b>
          <span>${s.done}/${s.total} done${s.doing ? ` · ${s.doing} doing` : ""}</span>
          ${s.overdue ? `<em class="late">${s.overdue} overdue</em>` : s.week ? `<em>${s.week} due this week</em>` : `<em>&nbsp;</em>`}</div></button>`;
    }).join("");
    return `${focusBlock(false)}
      <div class="section-title">🗂 Boards</div>
      <div class="bd-grid">${cards}</div>
      <div class="btn-row"><button class="btn-ghost small" type="button" data-bd="board-new">＋ New board</button><button class="btn-ghost small" type="button" data-bd="import">⬆ Import plan / tasks</button></div>`;
  }

  function relatedHabits(b) {
    if (!b.cat) return "";
    const goals = state.goals.filter((g) => g.cat === b.cat && !goalStats(g).ended);
    if (!goals.length) return "";
    return `<div class="section-title">Related habits</div><div class="mini-habits">${goals.map((g) => {
      const s = goalStats(g), c = colorOf(g);
      const act = !s.started ? `<span class="chip idle" style="margin:0">Starts ${shortDate(g.start)}</span>`
        : g.type === "daily"
        ? `<button class="quick ${s.todayAmt > 0 ? "done" : ""}" data-act="toggle" data-id="${g.id}">${s.todayAmt > 0 ? "✓" : "Done"}</button>`
        : `<button class="quick" style="--c:${c}" data-act="add" data-id="${g.id}" data-amt="${g.type === "total" ? g.step || 1 : 1}">+${fmt(g.type === "total" ? g.step || 1 : 1)}</button>`;
      return `<div class="mini-habit">${ring(s.pct, 40, 5, c, "")}<div><b>${esc(g.icon)} ${esc(g.name)}</b><small>${esc(progressText(g, s))}</small></div>${act}</div>`;
    }).join("")}</div>`;
  }

  function detail(b) {
    const s = stats(b.id), ts = state.tasks.filter((t) => t.boardId === b.id && passes(t));
    const cols = STATUS_ORDER.map((k) => {
      let list = sortTasks(ts.filter((t) => t.status === k));
      let more = "";
      if (k === "done" && list.length > 10) { more = `<p class="hint">+${list.length - 10} more done</p>`; list = list.sort((a, b2) => (b2.doneAt || "").localeCompare(a.doneAt || "")).slice(0, 10); }
      return `<div class="col ${ui.col === k ? "on" : ""}" data-col="${k}"><div class="col-head"><b>${STATUS[k]}</b><span>${ts.filter((t) => t.status === k).length}</span></div>${list.map(taskCard).join("") || `<p class="hint">Nothing here.</p>`}${more}</div>`;
    }).join("");
    const FILTERS = [["week", "This week"], ["today", "Today"], ["overdue", "Overdue"], ["all", "All"]];
    return `<div class="bd-top"><button class="btn-ghost small" data-bd="back">← Boards</button>
        <h2>${esc(b.icon)} ${esc(b.name)}</h2>${b.id === "inbox" ? "" : `<button class="btn-ghost small" data-bd="board-edit" data-id="${b.id}" aria-label="Edit board">✏️</button>`}</div>
      <div class="card"><div class="bar dark" style="--c:${b.color}"><i style="width:${s.pct * 100}%"></i></div>
        <p class="hint" style="margin-top:8px">${s.done} of ${s.total} done · ${s.week} due this week${s.overdue ? ` · <b class="late-t">${s.overdue} overdue</b>` : ""}</p></div>
      ${relatedHabits(b)}
      <form class="quick-add" data-add="${b.id}"><input name="title" maxlength="120" placeholder="Add a task to ${esc(b.name)}" aria-label="New task" required><button class="btn-primary small" type="submit">Add</button></form>
      <div class="chips fchips">${FILTERS.map(([k, l]) => `<button class="chip ${ui.filter === k ? "on" : ""}" data-bd="filter" data-k="${k}" type="button">${l}</button>`).join("")}</div>
      <div class="col-tabs">${STATUS_ORDER.map((k) => `<button type="button" class="${ui.col === k ? "on" : ""}" data-bd="col" data-k="${k}">${STATUS[k]} <span>${ts.filter((t) => t.status === k).length}</span></button>`).join("")}</div>
      <div class="kanban">${cols}</div>`;
  }

  function renderView() {
    const b = ui.boardId && state.boards.find((x) => x.id === ui.boardId);
    if (ui.boardId && !b) ui.boardId = null;
    return b ? detail(b) : overview();
  }

  /* ------------------------------------------------ sheets */
  function taskForm(id, boardId) {
    const t = id ? state.tasks.find((x) => x.id === id) : null;
    const v = t || { title: "", notes: "", boardId: boardId || ui.boardId || "inbox", status: "todo", priority: "medium", due: "", minutes: 0, focus: "" };
    openSheet(`<h2 style="margin:6px 0 0">${t ? "Edit task" : "New task"}</h2>
      <form id="taskForm" data-id="${t ? t.id : ""}">
        <label class="f">Task<input name="title" required maxlength="120" value="${esc(v.title)}"></label>
        <label class="f">Notes<textarea name="notes" rows="3" maxlength="500" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card)">${esc(v.notes)}</textarea></label>
        <div class="two"><label class="f">Board<select name="boardId">${state.boards.map((b) => `<option value="${b.id}" ${b.id === v.boardId ? "selected" : ""}>${esc(b.icon)} ${esc(b.name)}</option>`).join("")}</select></label>
          <label class="f">Status<select name="status">${STATUS_ORDER.map((k) => `<option value="${k}" ${k === v.status ? "selected" : ""}>${STATUS[k]}</option>`).join("")}</select></label></div>
        <div class="two"><label class="f">Due date<input name="due" type="date" value="${v.due}"></label>
          <label class="f">Minutes<input name="minutes" type="number" min="0" max="1440" value="${v.minutes || ""}"></label></div>
        <label class="f">Priority</label>
        <div class="seg">${Object.entries(PRIORITIES).map(([k, p]) => `<label><input type="radio" name="priority" value="${k}" ${v.priority === k ? "checked" : ""}><span>${p.icon} ${p.label}</span></label>`).join("")}</div>
        <label class="f chk-line"><input type="checkbox" name="focus" ${v.focus === todayStr() ? "checked" : ""}> ⭐ Focus on this today</label>
        <div class="btn-row"><button class="btn-primary" type="submit">${t ? "Save" : "Add task"}</button>${t ? `<button class="btn-danger" type="button" data-bd="task-del" data-id="${t.id}">🗑 Delete</button>` : ""}</div>
      </form>`);
  }

  function boardForm(id) {
    const b = id ? state.boards.find((x) => x.id === id) : null;
    const v = b || { name: "", icon: "🗂", color: "#4f46e5", cat: "" };
    openSheet(`<h2 style="margin:6px 0 0">${b ? "Edit board" : "New board"}</h2>
      <form id="boardForm" data-id="${b ? b.id : ""}">
        <label class="f">Board name<input name="name" required maxlength="30" value="${esc(v.name)}" placeholder="e.g. Home, Travel, Side project"></label>
        <div class="two"><label class="f">Icon<input name="icon" maxlength="4" value="${esc(v.icon)}"></label>
          <label class="f">Colour<input name="color" type="color" value="${v.color}" style="padding:4px;height:48px"></label></div>
        <div class="icons">${BOARD_ICONS.map((i) => `<label><input type="radio" name="pick" value="${i}" data-icon-pick>${i}</label>`).join("")}</div>
        <label class="f">Related habits (optional): show goals from this category on the board
          <select name="cat"><option value="">None</option>${Object.values(CATEGORIES).map((c) => `<option value="${c.id}" ${c.id === v.cat ? "selected" : ""}>${esc(c.icon)} ${esc(c.label)}</option>`).join("")}</select></label>
        <div class="btn-row"><button class="btn-primary" type="submit">${b ? "Save board" : "Create board"}</button>${b ? `<button class="btn-danger" type="button" data-bd="board-del" data-id="${b.id}">🗑 Delete</button>` : ""}</div>
      </form>`);
  }

  function pickSheet() {
    openSheet(`<h2 style="margin:6px 0 0">⭐ Pick today's tasks</h2>
      <p class="hint">Tick the tasks you want to finish today. They appear in "Focus today".</p>
      <input id="pickSearch" type="search" placeholder="Search tasks" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--card);margin:8px 0">
      <div id="pickList"></div>
      <div class="btn-row"><button class="btn-primary" data-act="close" type="button">Done</button></div>`);
    drawPick("");
  }
  function drawPick(q) {
    const t0 = todayStr(), qq = q.trim().toLowerCase();
    let list = state.tasks.filter((t) => t.status !== "done" && (!qq || t.title.toLowerCase().includes(qq) || boardById(t.boardId).name.toLowerCase().includes(qq)));
    if (!qq) list = list.filter((t) => !t.due || t.due <= addDays(t0, 7) || t.focus === t0);
    list = sortTasks(list).slice(0, 60);
    $("#pickList").innerHTML = list.length ? list.map((t) => {
      const b = boardById(t.boardId), di = dueInfo(t);
      return `<label class="pick"><input type="checkbox" data-pick="${t.id}" ${isFocus(t) ? "checked" : ""}><span><b>${esc(t.title)}</b><small>${esc(b.icon)} ${esc(b.name)}${di ? " · " + di.t : ""}${t.minutes ? " · " + t.minutes + " min" : ""}</small></span></label>`;
    }).join("") : `<p class="hint">No matching open tasks. ${qq ? "Try another search." : "Import a plan or add tasks first."}</p>`;
  }

  /* ------------------------------------------------ plan / CSV import */
  function parseCsv(text) {
    const rows = []; let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
      else cur += c;
    }
    row.push(cur); if (row.some((x) => x.trim() !== "")) rows.push(row);
    return rows;
  }
  function planFromCsv(text) {
    const rows = parseCsv(text.replace(/^﻿/, ""));
    if (rows.length < 2) throw new Error("the CSV has no rows");
    const head = rows[0].map((h) => h.trim().toLowerCase()), col = (n) => head.indexOf(n);
    if (col("title") < 0) throw new Error('the CSV needs a "title" column');
    const byBoard = new Map();
    for (const r of rows.slice(1)) {
      const name = (col("board") >= 0 ? r[col("board")] : "").trim() || "Inbox";
      if (!byBoard.has(name)) byBoard.set(name, { name, tasks: [] });
      byBoard.get(name).tasks.push({
        title: (r[col("title")] || "").trim(), day: Number(col("day") >= 0 ? r[col("day")] : "") || 0,
        due: col("due") >= 0 ? (r[col("due")] || "").trim() : "", minutes: col("minutes") >= 0 ? r[col("minutes")] : 0,
        priority: col("priority") >= 0 ? (r[col("priority")] || "").trim().toLowerCase() : "", notes: col("notes") >= 0 ? r[col("notes")] : "",
        status: col("status") >= 0 ? (r[col("status")] || "").trim().toLowerCase() : "",
      });
    }
    return { name: "CSV tasks", boards: [...byBoard.values()], habits: [] };
  }
  function parsePlan(text) {
    const t = text.trim();
    let plan;
    if (t.startsWith("{")) {
      try { plan = JSON.parse(t); } catch (e) { throw new Error("the file is not valid JSON"); }
      if (!Array.isArray(plan.boards)) throw new Error('a plan file needs a "boards" list');
    } else plan = planFromCsv(t);
    const nTasks = plan.boards.reduce((a, b) => a + (Array.isArray(b.tasks) ? b.tasks.length : 0), 0);
    if (!nTasks && !(plan.habits || []).length) throw new Error("the plan has no tasks or habits");
    return plan;
  }

  function applyPlan(plan, start, withHabits) {
    const out = { boards: 0, tasks: 0, skipped: 0, habits: 0 };
    const cats = CATEGORIES;
    for (const pb of plan.boards) {
      const name = String(pb.name || "Inbox").trim();
      let b = state.boards.find((x) => x.name.toLowerCase() === name.toLowerCase());
      if (!b) {
        const r = makeBoard({ name, icon: pb.icon, color: pb.color, category: pb.category }, cats);
        if (!r.board) continue;
        b = r.board; state.boards.push(b); out.boards++;
      }
      const ids = new Set(state.boards.map((x) => x.id));
      for (const t of Array.isArray(pb.tasks) ? pb.tasks : []) {
        const due = isDateStr(t.due) ? t.due : (Number(t.day) > 0 ? addDays(start, Number(t.day) - 1) : "");
        const r = makeTask({ ...t, boardId: b.id, due }, ids);
        if (!r.task) continue;
        if (state.tasks.some((x) => x.boardId === b.id && x.title === r.task.title && x.due === r.task.due)) { out.skipped++; continue; }
        state.tasks.push(r.task); out.tasks++;
      }
    }
    if (withHabits) {
      for (const h of plan.habits || []) {
        if (state.goals.some((g) => g.name.toLowerCase() === String(h.name || "").toLowerCase())) { out.skipped++; continue; }
        const res = makeGoal({ ...h, start, days: h.days || 60 });
        if (res.goal) { state.goals.push(res.goal); out.habits++; }
      }
    }
    save();
    return out;
  }

  function importSheet(plan, label) {
    pending = plan || null;
    const body = pending ? (() => {
      const nT = pending.boards.reduce((a, b) => a + (b.tasks || []).length, 0), nH = (pending.habits || []).length;
      return `<div class="card" style="margin:10px 0"><b>${esc(pending.name || label || "Plan")}</b>
        <p class="hint">${pending.boards.length} boards · ${nT} tasks · ${nH} starter habits</p>
        <ul class="plan-list">${pending.boards.map((b) => `<li>${esc(b.icon || "🗂")} ${esc(b.name)} <em>${(b.tasks || []).length} tasks</em></li>`).join("")}</ul></div>
        <form id="planForm">
          <label class="f">Day 1 of the plan is<input name="start" type="date" value="${esc(pending.startDate || todayStr())}" required></label>
          <p class="hint">Each task gets a due date from its day number. The plan was written for a Sunday start.</p>
          ${nH ? `<label class="f chk-line"><input type="checkbox" name="habits" checked> Also add the ${nH} starter habits (shown under Goals and on each board)</label>` : ""}
          <div class="btn-row"><button class="btn-primary" type="submit">Import into my boards</button></div></form>`;
    })() : `<p class="hint">Choose a plan file (.json) or a spreadsheet export (.csv) with columns: board, day, due, title, minutes, priority, notes. Importing adds to your boards and skips tasks you already have.</p>`;
    openSheet(`<h2 style="margin:6px 0 0">⬆ Import plan / tasks</h2>
      ${window.BUILTIN_PLAN && !pending ? `<div class="btn-row"><button class="btn-primary" type="button" data-bd="plan-builtin">📅 Load the 60-day master plan</button></div><p class="hint" style="text-align:center">or choose your own file</p>` : ""}
      <label class="btn-ghost" style="display:block;text-align:center;cursor:pointer;margin-top:8px">📂 Choose .json or .csv file<input id="planFile" type="file" accept=".json,.csv,application/json,text/csv" hidden></label>
      ${body}`);
  }

  /* ------------------------------------------------ tasks CSV (export) */
  function tasksCsv() {
    const q = (v) => (typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '""')}"`);
    const rows = [["board", "title", "status", "due", "minutes", "priority", "notes"]];
    for (const t of state.tasks) rows.push([boardById(t.boardId).name, t.title, t.status, t.due, t.minutes, t.priority, t.notes]);
    return rows.map((r) => r.map(q).join(",")).join("\n");
  }

  /* ------------------------------------------------ events */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-bd]"); if (!el) return;
    const a = el.dataset.bd, id = el.dataset.id, t = id && state.tasks.find((x) => x.id === id);
    switch (a) {
      case "goto": tab = "boards"; ui.boardId = null; render(); break;
      case "board-open": ui.boardId = id; ui.filter = "week"; ui.col = "todo"; render(); window.scrollTo(0, 0); break;
      case "back": ui.boardId = null; render(); break;
      case "filter": ui.filter = el.dataset.k; render(); break;
      case "col": ui.col = el.dataset.k; render(); break;
      case "board-new": boardForm(); break;
      case "board-edit": boardForm(id); break;
      case "board-del": {
        const b = state.boards.find((x) => x.id === id);
        if (b && b.id !== "inbox" && confirm(`Delete board "${b.name}"? Its tasks move to the Inbox.`)) {
          deleteBoard(id); ui.boardId = null; closeSheet(); save(); render(); toast("Board deleted");
        }
        break;
      }
      case "task-open": taskForm(id); break;
      case "task-toggle": if (t) { setStatus(t, t.status === "done" ? "todo" : "done"); save(); render(); if (t.status === "done") toast("Task done ✓"); } break;
      case "task-focus": if (t) { t.focus = isFocus(t) ? "" : todayStr(); save(); render(); toast(t.focus ? "Added to today's focus ⭐" : "Removed from today's focus"); } break;
      case "task-move": if (t) { const i = STATUS_ORDER.indexOf(t.status) + Number(el.dataset.dir); if (i >= 0 && i < 3) { setStatus(t, STATUS_ORDER[i]); save(); render(); } } break;
      case "task-del": if (t && confirm(`Delete "${t.title}"?`)) { state.tasks = state.tasks.filter((x) => x.id !== id); closeSheet(); save(); render(); toast("Task deleted"); } break;
      case "pick": pickSheet(); break;
      case "import": importSheet(null); break;
      case "plan-builtin": importSheet(window.BUILTIN_PLAN); break;
    }
  });

  document.addEventListener("submit", (e) => {
    const f = e.target;
    if (f.matches("[data-quick]")) {                      // anonymous quick task -> Inbox, focused today
      e.preventDefault();
      if (addTask("inbox", f.title.value, { focus: todayStr() })) { f.reset(); render(); toast("Added to today's focus ⭐"); }
    } else if (f.matches("[data-add]")) {
      e.preventDefault();
      if (addTask(f.dataset.add, f.title.value)) { render(); toast("Task added"); }
    } else if (f.id === "taskForm") {
      e.preventDefault();
      const d = new FormData(f), ids = new Set(state.boards.map((b) => b.id)), old = f.dataset.id && state.tasks.find((x) => x.id === f.dataset.id);
      const r = makeTask({ id: old && old.id, title: d.get("title"), notes: d.get("notes"), boardId: d.get("boardId"), status: d.get("status"), priority: d.get("priority"),
        due: d.get("due"), minutes: d.get("minutes"), focus: d.get("focus") ? todayStr() : "", createdAt: old && old.createdAt, doneAt: old && old.doneAt }, ids);
      if (r.errors) { toast("⚠ " + r.errors[0]); return; }
      if (old) Object.assign(old, r.task); else state.tasks.push(r.task);
      closeSheet(); save(); render(); toast(old ? "Task updated" : "Task added");
    } else if (f.id === "boardForm") {
      e.preventDefault();
      const d = new FormData(f), old = f.dataset.id && state.boards.find((x) => x.id === f.dataset.id);
      const r = makeBoard({ id: old && old.id, name: d.get("name"), icon: d.get("icon"), color: d.get("color"), category: d.get("cat") }, CATEGORIES);
      if (r.errors) { toast("⚠ " + r.errors[0]); return; }
      if (old) Object.assign(old, r.board); else { state.boards.push(r.board); ui.boardId = r.board.id; }
      closeSheet(); save(); render(); toast(old ? "Board updated" : "Board created");
    } else if (f.id === "planForm" && pending) {
      e.preventDefault();
      const d = new FormData(f), res = applyPlan(pending, d.get("start"), !!d.get("habits"));
      pending = null; closeSheet(); tab = "boards"; ui.boardId = null; render();
      toast(`Imported ${res.tasks} tasks${res.habits ? ", " + res.habits + " habits" : ""}${res.boards ? ", " + res.boards + " boards" : ""}${res.skipped ? " (" + res.skipped + " already there)" : ""}`);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.id === "planFile") {
      const file = t.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { try { importSheet(parsePlan(reader.result), file.name); } catch (err) { toast("Import failed: " + err.message); } };
      reader.readAsText(file);
    } else if (t.dataset && t.dataset.pick) {
      const task = state.tasks.find((x) => x.id === t.dataset.pick);
      if (task) { task.focus = t.checked ? todayStr() : ""; save(); render(); }
    } else if (t.matches && t.matches("[data-icon-pick]")) {
      const inp = $("#boardForm [name=icon]"); if (inp) inp.value = t.value;
    }
  });
  document.addEventListener("input", (e) => { if (e.target.id === "pickSearch") drawPick(e.target.value); });

  window.Boards = {
    makeBoard, makeTask, deleteBoard, addTask, normalize: normalizeBoards, renderView, focusBlock, parsePlan, applyPlan, planFromCsv, tasksCsv, stats,
    insightsCard() {
      const rows = state.boards.filter((b) => tasksOf(b.id).length).map((b) => {
        const s = stats(b.id);
        return `<div class="catrow"><div class="lab">${esc(b.icon)} ${esc(b.name)}</div><div class="bar dark" style="--c:${b.color}"><i style="width:${s.pct * 100}%"></i></div><div class="pc">${Math.round(s.pct * 100)}%</div></div>`;
      }).join("");
      return rows ? `<div class="card"><h3 class="h">Task progress by board</h3>${rows}</div>` : "";
    },
    backupButtons() {
      return `<button class="btn-ghost" data-bd="import">📋 Import plan / tasks</button><button class="btn-ghost" data-act="exporttasks">🗂 Export tasks (CSV)</button>`;
    },
    resetView() { ui.boardId = null; },
    isDetail() { return !!ui.boardId; },
  };
})();
