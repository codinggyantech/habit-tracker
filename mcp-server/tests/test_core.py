"""Run:  .venv/bin/python -m unittest discover -s tests -v   (from the mcp-server folder)"""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import habit_core as core  # noqa: E402

TODAY = date(2026, 10, 31)  # the same "today" the Node stub uses
APP_JS = HERE.parent.parent / "app.js"


def d(n):  # n days before TODAY, as YYYY-MM-DD
    return (TODAY - timedelta(days=n)).isoformat()


def sample_file(path: Path):
    """A v2 file covering every case: ahead, behind, done, daily streak, not started, ended, decimals."""
    goals = [
        {"id": "g_push", "name": "Push-ups", "type": "total", "target": 500, "unit": "push-ups", "step": 20, "days": 60, "start": d(20), "category": "health", "priority": "high", "visibility": "public", "icon": "💪"},
        {"id": "g_work", "name": "Workouts", "type": "times", "target": 24, "days": 60, "start": d(20), "category": "health", "priority": "medium", "icon": "🏃"},
        {"id": "g_read", "name": "Read 20 pages", "type": "daily", "days": 30, "start": d(11), "category": "learning", "priority": "low", "icon": "📚"},
        {"id": "g_done", "name": "Finish course", "type": "total", "target": 10, "unit": "hours", "step": 1, "days": 30, "start": d(6), "category": "learning", "priority": "high", "icon": "🎓"},
        {"id": "g_future", "name": "Future goal", "type": "times", "target": 5, "days": 20, "start": (TODAY + timedelta(days=5)).isoformat(), "category": "other", "priority": "low", "icon": "🎯"},
        {"id": "g_ended", "name": "Old challenge", "type": "total", "target": 100, "unit": "km", "step": 5, "days": 20, "start": d(60), "category": "health", "priority": "medium", "icon": "🚴"},
        {"id": "g_hours", "name": "Deep work hours", "type": "total", "target": 80, "unit": "hours", "step": 1, "days": 60, "start": d(20), "category": "productivity", "priority": "high", "icon": "⚡"},
    ]
    logs = []

    def put(gid, ago, amt):
        logs.append({"id": f"l{len(logs)}", "goalId": gid, "date": d(ago), "amount": amt, "ts": 1000 + len(logs)})

    for ago in range(20, -1, -1):
        if ago % 3 != 2: put("g_push", ago, [20, 25, 15, 30][ago % 4])
        if ago % 3 == 0: put("g_work", ago, 1)
        if ago % 7 < 5: put("g_hours", ago, [1, 2, 1.5, 2.5][ago % 4])
    for ago in (10, 9, 7, 3, 2, 1, 0): put("g_read", ago, 1)          # streak of 4 ending today
    for ago in (5, 4, 3, 2): put("g_done", ago, 3)                    # 12 >= 10 -> done
    for ago in (55, 50, 45): put("g_ended", ago, 20)                  # 60 of 100, ended
    path.write_text(json.dumps({"app": "habit-tracker", "schemaVersion": 2, "categories": [], "goals": goals, "logs": logs}))


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.path = self.tmp / "habit-data.json"
        self.store = core.Store(self.path, today=TODAY)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- standard goal validation
    def test_make_goal_rules(self):
        ids = {"other"}
        _, e = core.make_goal({"name": "", "type": "x", "days": 0, "start": "2026-13-40"}, ids)
        self.assertGreaterEqual(len(e), 4)
        g, e = core.make_goal({"name": "Read", "type": "daily", "days": 30, "start": "2026-11-01"}, ids)
        self.assertEqual(e, []); self.assertEqual(g["target"], 0); self.assertEqual(g["priority"], "medium")
        _, e = core.make_goal({"name": "A", "type": "times", "days": 10, "start": "2026-11-01", "target": 0}, ids)
        self.assertIn("target must be greater than 0", e)
        g, _ = core.make_goal({"name": "A", "type": "times", "days": 10, "start": "2026-11-01", "target": 5, "unit": "zzz", "cat": "nope", "vis": "public"}, ids)
        self.assertEqual((g["unit"], g["category"], g["visibility"]), ("times", "other", "public"))  # phase-1 names accepted

    # ---- file handling
    def test_missing_file_is_empty_and_first_write_creates_it(self):
        self.assertFalse(self.store.exists())
        self.assertEqual(self.store.list_goals(), [])
        self.store.create_goal(name="Walk", kind="daily", days=30)
        self.assertTrue(self.path.exists())
        raw = json.loads(self.path.read_text())
        self.assertEqual(raw["schemaVersion"], 3); self.assertEqual(raw["goals"][0]["category"], "other")
        self.assertIn("summary", raw["goals"][0])

    def test_create_goal_defaults_start_to_today_even_when_none_is_passed(self):
        g = self.store.create_goal(name="Walk", kind="daily", days=30, start=None)   # AI clients send null for omitted args
        self.assertEqual(g["start"], TODAY.isoformat())

    def test_boards_and_tasks_survive_a_server_write(self):
        """The web app's boards/tasks must be written back untouched when the AI changes a habit."""
        sample_file(self.path)
        raw = json.loads(self.path.read_text())
        raw["boards"] = [{"id": "inbox", "name": "Inbox", "icon": "📥", "color": "#64748b", "category": ""},
                         {"id": "b1", "name": "Health", "icon": "💪", "color": "#16a34a", "category": "health"}]
        raw["tasks"] = [{"id": "t1", "boardId": "b1", "title": "Baseline test", "status": "done", "priority": "high",
                         "due": "2026-11-01", "minutes": 45, "focus": "", "createdAt": 1, "doneAt": "2026-11-01", "notes": ""}]
        self.path.write_text(json.dumps(raw))
        self.store.log_progress("Workouts")                      # makes the server rewrite the file
        after = json.loads(self.path.read_text())
        self.assertEqual(after["schemaVersion"], 3)
        self.assertEqual(after["boards"], raw["boards"])
        self.assertEqual(after["tasks"], raw["tasks"])

    def test_phase1_file_loads(self):
        v1 = {"goals": [{"id": "a", "name": "Old", "type": "daily", "days": 30, "start": d(3), "cat": "health", "vis": "public", "icon": "x"}],
              "logs": [{"goalId": "a", "date": d(1), "amount": 1}]}
        self.path.write_text(json.dumps(v1))
        g = self.store.list_goals()[0]
        self.assertEqual((g["category"], g["visibility"], g["priority"]), ("health", "public", "medium"))

    def test_bad_and_newer_files(self):
        self.path.write_text("not json")
        with self.assertRaises(core.HabitError): self.store.load()
        self.path.write_text(json.dumps({"schemaVersion": 99, "goals": [], "logs": []}))
        with self.assertRaises(core.HabitError): self.store.load()

    def test_save_keeps_backup(self):
        self.store.create_goal(name="One", kind="daily", days=10)
        self.store.create_goal(name="Two", kind="daily", days=10)
        self.assertTrue((self.tmp / "habit-data.json.bak").exists())
        self.assertEqual([p.name for p in self.tmp.glob(".habit-*")], [])  # no temp files left

    # ---- operations
    def test_create_log_undo_flow(self):
        g = self.store.create_goal(name="Push-ups", kind="total", target=500, unit="push-ups", step=20, days=60, category="Health", priority="high")
        self.assertEqual((g["category"], g["quickAddAmount"]), ("health", 20))
        r = self.store.log_progress("push")                # partial name, default amount = step
        self.assertEqual((r["loggedAmount"], r["percent"]), (20, 4.0))
        r = self.store.log_progress("Push-ups", 30)
        self.assertEqual(r["percent"], 10.0)
        r = self.store.undo_last_log("Push-ups")
        self.assertEqual(r["percent"], 4.0)

    def test_daily_logs_once_and_dates_checked(self):
        self.store.create_goal(name="Meditate", kind="daily", days=30, start=d(2))
        self.assertEqual(self.store.log_progress("Meditate")["streak"], 1)
        self.assertIn("Already", self.store.log_progress("Meditate")["message"])
        with self.assertRaises(core.HabitError): self.store.log_progress("Meditate", on=(TODAY + timedelta(days=1)).isoformat())
        with self.assertRaises(core.HabitError): self.store.log_progress("Meditate", on=d(5))   # before start

    def test_lookup_errors_are_helpful(self):
        self.store.create_goal(name="Run 5k", kind="times", target=10, days=30)
        self.store.create_goal(name="Run 10k", kind="times", target=10, days=30)
        with self.assertRaises(core.HabitError) as c: self.store.log_progress("run")
        self.assertIn("Run 5k", str(c.exception))
        with self.assertRaises(core.HabitError) as c: self.store.log_progress("swim")
        self.assertIn("Existing goals", str(c.exception))
        with self.assertRaises(core.HabitError): self.store.create_goal(name="run 5k", kind="times", target=3, days=5)  # duplicate

    def test_update_goal_and_categories(self):
        self.store.create_goal(name="Read", kind="daily", days=30)
        cat = self.store.add_category("Family", "👨‍👩‍👧", "#ef4444")
        g = self.store.update_goal("Read", priority="high", category="Family")
        self.assertEqual((g["priority"], g["category"]), ("high", cat["id"]))
        with self.assertRaises(core.HabitError): self.store.update_goal("Read", priority="urgent")
        with self.assertRaises(core.HabitError): self.store.update_goal("Read", category="Nope")
        with self.assertRaises(core.HabitError): self.store.add_category("family")

    def test_summaries(self):
        sample_file(self.path)
        t = self.store.today_summary()
        self.assertIn("Read 20 pages", [x["name"] for x in t["doneToday"]])
        self.assertEqual(t["stillToDoToday"][0]["priority"], "high")           # high priority first
        self.assertIn("Workouts", t["behindPace"])
        w = self.store.weekly_review(7)
        self.assertEqual(w["periodDays"], 7)

    # ---- parity with the web app (runs the real app.js in Node)
    @unittest.skipUnless(shutil.which("node") and APP_JS.exists(), "node or app.js not available")
    def test_matches_web_app_numbers(self):
        sample_file(self.path)
        out = subprocess.run(["node", str(HERE / "run_app_export.js"), str(APP_JS), str(self.path)],
                             capture_output=True, text=True, check=True).stdout
        js = json.loads(out)
        self.assertEqual(js["warnings"], [])
        js_goals = {g["id"]: g for g in js["export"]["goals"]}
        py_goals = {g["id"]: g for g in self.store.list_goals()}
        self.assertEqual(set(js_goals), set(py_goals))
        for gid, jg in js_goals.items():
            pg, js_sum = py_goals[gid], jg["summary"]
            for key_js, key_py in [("done", None), ("percent", "percent"), ("status", "status"), ("remaining", "remaining"),
                                   ("needPerDay", "needPerDay"), ("daysLeft", "daysLeft"), ("streak", "streak"), ("todayAmount", "todayAmount")]:
                if key_py is None:
                    continue
                a, b = js_sum[key_js], pg[key_py]
                if isinstance(a, (int, float)):
                    self.assertAlmostEqual(a, b, delta=0.011, msg=f"{jg['name']}.{key_js}: app={a} server={b}")
                else:
                    self.assertEqual(a, b, f"{jg['name']}.{key_js}")
            self.assertEqual(jg["end"], pg["end"])
            self.assertEqual((jg["category"], jg["priority"], jg["visibility"]), (pg["category"], pg["priority"], pg["visibility"]))

    def test_file_written_by_server_imports_into_app(self):
        """The server's output must be a valid app import (round trip through the real app.js parser)."""
        if not (shutil.which("node") and APP_JS.exists()):
            self.skipTest("node not available")
        sample_file(self.path)
        self.store.log_progress("Workouts")                    # makes the server write the file
        out = subprocess.run(["node", str(HERE / "run_app_export.js"), str(APP_JS), str(self.path)],
                             capture_output=True, text=True, check=True).stdout
        js = json.loads(out)
        self.assertEqual(js["warnings"], [])
        self.assertEqual(len(js["export"]["goals"]), 7)


if __name__ == "__main__":
    unittest.main()
