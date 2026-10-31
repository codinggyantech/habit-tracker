// Runs the REAL app.js in Node (with a stub browser) on a data file and prints the app's own export.
// Used by test_core.py to prove the Python server calculates progress exactly like the web app.
// Usage: node run_app_export.js <path/to/app.js> <path/to/data.json>
const fs = require("fs");
const vm = require("vm");

const [, , appPath, dataPath] = process.argv;
const RealDate = Date;
class FixedDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(2026, 9, 31, 12, 0, 0); else super(...a); }
  static now() { return new RealDate(2026, 9, 31, 12, 0, 0).getTime(); }
}
const noop = new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : noop),
  apply: () => noop,
  set: () => true,
});
const ctx = {
  Date: FixedDate, console, setTimeout, clearTimeout, URL, Blob,
  localStorage: { getItem: () => null, setItem() {} },
  navigator: {}, location: { protocol: "http:" }, confirm: () => true, addEventListener() {}, scrollTo() {},
  document: { querySelector: () => noop, querySelectorAll: () => [], addEventListener() {}, body: noop, createElement: () => noop, hidden: false },
};
ctx.window = ctx;
vm.createContext(ctx);
const dir = require("path").dirname(appPath);
const boardsPath = require("path").join(dir, "boards.js");
if (fs.existsSync(boardsPath)) vm.runInContext(fs.readFileSync(boardsPath, "utf8"), ctx);   // app.js uses window.Boards
vm.runInContext(fs.readFileSync(appPath, "utf8"), ctx);
const text = fs.readFileSync(dataPath, "utf8");
const out = vm.runInContext(
  `(() => { const r = parseImport(${JSON.stringify(text)}); state = r.state; rebuildCats();
    return JSON.stringify({ warnings: r.warnings, export: exportPayload() }); })()`, ctx);
process.stdout.write(out);
