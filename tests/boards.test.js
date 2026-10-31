// Tests for boards, tasks, plan import and the save/load round trip. Runs the REAL app code in Node with a stub browser.
// Run from the project folder:   node --test tests/
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const RealDate = Date;
class FixedDate extends RealDate {                       // "today" is Saturday 31 Oct 2026
  constructor(...a) { if (a.length === 0) super(2026, 9, 31, 12, 0, 0); else super(...a); }
  static now() { return new RealDate(2026, 9, 31, 12, 0, 0).getTime(); }
}

/** Boots the app exactly like index.html does (builtin plan, boards.js, app.js) with optional saved data. */
function boot(saved) {
  const store = new Map();
  if (saved !== undefined) store.set("habitTracker.v1", typeof saved === "string" ? saved : JSON.stringify(saved));
  const noop = new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => "" : noop), apply: () => noop, set: () => true });
  const ctx = {
    Date: FixedDate, console: { log() {}, error() {} }, setTimeout, clearTimeout, URL, Blob, confirm: () => true,
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    navigator: {}, location: { protocol: "http:" }, addEventListener() {}, scrollTo() {},
    document: { querySelector: () => noop, querySelectorAll: () => [], addEventListener() {}, body: noop, createElement: () => noop, hidden: false },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of ["plans/builtin-plan.js", "boards.js", "app.js"]) vm.runInContext(read(f), ctx, { filename: f });
  return { ctx, store, run: (code) => vm.runInContext(code, ctx) };
}

test("data survives a reload (regression: state loaded before date helpers existed)", () => {
  const a = boot();
  a.run(`const r = Boards.applyPlan(BUILTIN_PLAN, "2026-11-01", true); save(); r`);
  const saved = a.store.get("habitTracker.v1");
  const b = boot(saved);                                           // a fresh page load
  assert.strictEqual(b.run("state.tasks.length"), 240);
  assert.strictEqual(b.run("state.goals.length"), 10);
  assert.strictEqual(b.run("state.boards.length"), 5);             // Inbox + 4 plan boards
  assert.strictEqual(b.store.has("habitTracker.v1.unreadable"), false);
});

test("unreadable saved data is kept as a copy, never silently lost", () => {
  const b = boot("{ not json");
  assert.strictEqual(b.run("state.goals.length"), 0);
  assert.strictEqual(b.store.get("habitTracker.v1.unreadable"), "{ not json");
});

test("old Phase 1 / v2 data (no boards or tasks) loads with just an Inbox", () => {
  const b = boot({ goals: [], logs: [] });
  assert.deepStrictEqual(JSON.parse(b.run("JSON.stringify(state.boards.map(x => x.id))")), ["inbox"]);
  assert.strictEqual(b.run("state.tasks.length"), 0);
});

test("makeTask validates and defaults", () => {
  const b = boot();
  const ok = JSON.parse(b.run(`JSON.stringify(Boards.makeTask({ title: "  Call mum ", boardId: "nope", priority: "urgent", due: "2026-02-31", minutes: "30" }, new Set(["inbox"])))`));
  assert.strictEqual(ok.task.title, "Call mum");
  assert.strictEqual(ok.task.boardId, "inbox");           // unknown board falls back to Inbox
  assert.strictEqual(ok.task.priority, "medium");         // invalid priority -> medium
  assert.strictEqual(ok.task.due, "");                    // impossible date dropped
  assert.strictEqual(ok.task.minutes, 30);
  assert.ok(JSON.parse(b.run(`JSON.stringify(Boards.makeTask({ title: "   " }, new Set(["inbox"])))`)).errors);
});

test("the 60-day plan imports 240 dated tasks and 10 habits, and a second import adds nothing", () => {
  const b = boot();
  const first = JSON.parse(b.run(`JSON.stringify(Boards.applyPlan(BUILTIN_PLAN, "2026-11-01", true))`));
  assert.deepStrictEqual([first.boards, first.tasks, first.habits], [4, 240, 10]);
  const dues = JSON.parse(b.run(`JSON.stringify(state.tasks.map(t => t.due).sort())`));
  assert.strictEqual(dues[0], "2026-11-01");
  assert.strictEqual(dues[dues.length - 1], "2026-12-30");
  const second = JSON.parse(b.run(`JSON.stringify(Boards.applyPlan(BUILTIN_PLAN, "2026-11-01", true))`));
  assert.strictEqual(second.tasks, 0);
  assert.strictEqual(second.habits, 0);
  assert.strictEqual(b.run("state.tasks.length"), 240);
});

test("a different start date shifts every due date", () => {
  const b = boot();
  b.run(`Boards.applyPlan(BUILTIN_PLAN, "2026-12-06", false)`);
  const dues = JSON.parse(b.run(`JSON.stringify(state.tasks.map(t => t.due).sort())`));
  assert.strictEqual(dues[0], "2026-12-06");
  assert.strictEqual(b.run("state.goals.length"), 0);       // habits not requested
});

test("CSV import: quoted commas, board matching, blank board goes to Inbox", () => {
  const b = boot();
  const csv = 'board,day,due,title,minutes,priority,notes\nHealth,1,,"Run, then stretch",30,high,"note, with comma"\n,,2026-11-05,Pay rent,5,low,\nHealth,2,,Walk,20,,\n';
  const plan = JSON.parse(b.run(`JSON.stringify(Boards.parsePlan(${JSON.stringify(csv)}))`));
  assert.deepStrictEqual(plan.boards.map((x) => [x.name, x.tasks.length]), [["Health", 2], ["Inbox", 1]]);
  b.run(`Boards.applyPlan(Boards.parsePlan(${JSON.stringify(csv)}), "2026-11-01", false)`);
  const t = JSON.parse(b.run(`JSON.stringify(state.tasks.find(t => t.title === "Run, then stretch"))`));
  assert.strictEqual(t.due, "2026-11-01"); assert.strictEqual(t.priority, "high"); assert.strictEqual(t.notes, "note, with comma");
  assert.strictEqual(JSON.parse(b.run(`JSON.stringify(state.tasks.find(t => t.title === "Pay rent"))`)).boardId, "inbox");
  assert.throws(() => b.run(`Boards.parsePlan("a,b\\n1,2")`), /title/);
  assert.throws(() => b.run(`Boards.parsePlan("{ nope")`), /JSON/);
});

test("export then import round-trips boards, tasks and focus", () => {
  const a = boot();
  a.run(`Boards.applyPlan(BUILTIN_PLAN, "2026-11-01", true); state.tasks[0].focus = todayStr(); state.tasks[1].status = "done"; state.tasks[1].doneAt = "2026-11-02";`);
  const file = a.run(`JSON.stringify(exportPayload())`);
  const payload = JSON.parse(file);
  assert.strictEqual(payload.schemaVersion, 3);
  assert.strictEqual(payload.tasks.length, 240);
  const b = boot();
  const res = JSON.parse(b.run(`(() => { const r = parseImport(${JSON.stringify(file)}); state = r.state; return JSON.stringify({ w: r.warnings, tasks: state.tasks.length, boards: state.boards.length, focus: state.tasks[0].focus, done: state.tasks[1].status }); })()`));
  assert.deepStrictEqual(res.w, []);
  assert.deepStrictEqual([res.tasks, res.boards, res.focus, res.done], [240, 5, "2026-10-31", "done"]);
});

test("focus list: picked tasks plus anything due today; done tasks sort last", () => {
  const b = boot();
  b.run(`Boards.applyPlan({ boards: [{ name: "Home", tasks: [{ title: "A", due: "2026-10-31" }, { title: "B" }, { title: "C" }] }] }, "2026-10-31", false);
         state.tasks.find(t => t.title === "B").focus = todayStr(); state.tasks.find(t => t.title === "A").status = "done";`);
  const html = b.run(`Boards.focusBlock(false)`);
  assert.match(html, /1\/2 done/);
  assert.ok(html.indexOf(">B<") < html.indexOf(">A<"), "open task listed before the done one");
  assert.ok(!html.includes(">C<"), "unpicked task is not in today's focus");
});

test("deleting a board moves its tasks to the Inbox; the Inbox cannot be deleted", () => {
  const b = boot();
  b.run(`Boards.applyPlan({ boards: [{ name: "Home", tasks: [{ title: "Fix tap" }, { title: "Paint" }] }] }, "2026-11-01", false)`);
  const id = b.run(`state.boards.find(x => x.name === "Home").id`);
  assert.strictEqual(b.run(`Boards.deleteBoard(${JSON.stringify(id)})`), 2);
  assert.deepStrictEqual(JSON.parse(b.run(`JSON.stringify(state.boards.map(x => x.name))`)), ["Inbox"]);
  assert.strictEqual(b.run(`state.tasks.filter(t => t.boardId === "inbox").length`), 2);
  assert.strictEqual(b.run(`Boards.deleteBoard("inbox")`), 0);
  assert.strictEqual(b.run(`state.boards.length`), 1);
});

test("a quick (anonymous) task lands in the Inbox focused today", () => {
  const b = boot();
  const t = JSON.parse(b.run(`JSON.stringify(Boards.addTask("inbox", "Call the electrician", { focus: todayStr() }))`));
  assert.strictEqual(t.boardId, "inbox"); assert.strictEqual(t.focus, "2026-10-31"); assert.strictEqual(t.status, "todo");
});
