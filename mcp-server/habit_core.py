"""Habit Tracker core logic (no MCP code here, so it is easy to test).

Reads and writes the same JSON file the web app exports/imports (schemaVersion 2, see
../docs/data-format.md). The validation and progress maths mirror app.js on purpose.
"""
from __future__ import annotations

import json
import math
import os
import re
import secrets
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

SCHEMA_VERSION = 3
TYPES = ("daily", "times", "total")
PRIORITIES = {"high": 0, "medium": 1, "low": 2}
VISIBILITIES = ("private", "public")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

DEFAULT_CATEGORIES = [
    {"id": "health", "label": "Health", "icon": "💪", "color": "#16a34a"},
    {"id": "productivity", "label": "Productivity", "icon": "⚡", "color": "#4f46e5"},
    {"id": "work", "label": "Work", "icon": "💼", "color": "#0284c7"},
    {"id": "learning", "label": "Learning", "icon": "📚", "color": "#d97706"},
    {"id": "mind", "label": "Mind", "icon": "🧘", "color": "#9333ea"},
    {"id": "wealth", "label": "Wealth", "icon": "💰", "color": "#ca8a04"},
    {"id": "other", "label": "Other", "icon": "✨", "color": "#db2777"},
]


class HabitError(ValueError):
    """A problem the AI/user can fix (bad input, goal not found...)."""


# ------------------------------------------------------------------ small helpers
def new_id() -> str:
    return secrets.token_hex(6)


def r2(n: float) -> float:
    v = round(n + 0.0, 2)
    return int(v) if v == int(v) else v


def parse_date(s: Any) -> Optional[date]:
    if not isinstance(s, str) or not DATE_RE.match(s):
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def default_path() -> Path:
    env = os.environ.get("HABIT_DATA")
    if env:
        return Path(env).expanduser()
    return Path(__file__).resolve().parent / "data" / "habit-data.json"


# ------------------------------------------------------------------ normalising (accepts Phase 1 names too)
def normalize_store(raw: dict) -> dict:
    cats = [
        {"id": str(c["id"]), "label": str(c["label"])[:24], "icon": str(c.get("icon") or "🏷")[:4],
         "color": c["color"] if re.match(r"^#[0-9a-fA-F]{6}$", str(c.get("color", ""))) else "#0ea5e9"}
        for c in (raw.get("categories") or []) if isinstance(c, dict) and c.get("id") and c.get("label")
    ] or [dict(c) for c in DEFAULT_CATEGORIES]
    if not any(c["id"] == "other" for c in cats):
        cats.append(dict(DEFAULT_CATEGORIES[-1]))
    cat_ids = {c["id"] for c in cats}

    goals = []
    for g in raw.get("goals") or []:
        goal, errs = make_goal(g if isinstance(g, dict) else {}, cat_ids)
        if goal:
            goals.append(goal)
    ids = {g["id"] for g in goals}
    logs = []
    for l in raw.get("logs") or []:
        log, _ = make_log(l if isinstance(l, dict) else {}, ids)
        if log:
            logs.append(log)
    settings = {"sort": "priority", "group": "category"}
    settings.update(raw.get("settings") or {})
    # Boards and tasks belong to the web app. We do not edit them, but we must write them back unchanged,
    # otherwise an AI logging a habit would silently delete the user's boards.
    boards = [b for b in (raw.get("boards") or []) if isinstance(b, dict)]
    tasks = [t for t in (raw.get("tasks") or []) if isinstance(t, dict)]
    return {"categories": cats, "settings": settings, "goals": goals, "logs": logs, "boards": boards, "tasks": tasks}


def make_goal(raw: dict, cat_ids: set, today: Optional[date] = None) -> tuple[Optional[dict], list[str]]:
    """Validate/normalise one goal. Returns (goal, errors). Same rules as makeGoal() in app.js."""
    errors: list[str] = []
    name = str(raw.get("name") or "").strip()[:60]
    if not name:
        errors.append("name is required")
    gtype = raw.get("type")
    if gtype not in TYPES:
        errors.append(f"type must be one of: {', '.join(TYPES)}")
    try:
        days = int(round(float(raw.get("days"))))
    except (TypeError, ValueError):
        days = 0
    if not 1 <= days <= 730:
        errors.append("days must be between 1 and 730")
    start = raw.get("start")
    if parse_date(start) is None:
        errors.append("start must be a valid date (YYYY-MM-DD)")
    target = 0.0
    if gtype != "daily":
        try:
            target = float(raw.get("target"))
        except (TypeError, ValueError):
            target = 0.0
        if not target > 0 or not math.isfinite(target):
            errors.append("target must be greater than 0")
    step = 1.0
    if gtype == "total":
        try:
            step = float(raw.get("step") if raw.get("step") is not None else 1)
        except (TypeError, ValueError):
            step = 0.0
        if not step > 0:
            errors.append("step must be greater than 0")
    priority = raw.get("priority") or "medium"
    if priority not in PRIORITIES:
        errors.append("priority must be high, medium or low")
    visibility = raw.get("visibility") or raw.get("vis") or "private"
    if visibility not in VISIBILITIES:
        errors.append("visibility must be private or public")
    if errors:
        return None, errors
    category = raw.get("category") or raw.get("cat") or "other"
    unit = ""
    if gtype == "total":
        unit = str(raw.get("unit") or "").strip()[:20]
    elif gtype == "times":
        unit = "times"
    return {
        "id": str(raw.get("id") or new_id()), "name": name, "type": gtype,
        "target": r2(target), "unit": unit, "step": r2(step), "days": days, "start": start,
        "category": category if category in cat_ids else "other", "priority": priority,
        "visibility": visibility, "icon": str(raw.get("icon") or "🎯")[:4],
    }, []


def make_log(raw: dict, goal_ids: set) -> tuple[Optional[dict], Optional[str]]:
    try:
        amount = float(raw.get("amount"))
    except (TypeError, ValueError):
        return None, "amount must be a number"
    if raw.get("goalId") not in goal_ids:
        return None, "unknown goal"
    if parse_date(raw.get("date")) is None:
        return None, "bad date"
    if not amount > 0 or not math.isfinite(amount):
        return None, "amount must be greater than 0"
    return {"id": str(raw.get("id") or new_id()), "goalId": raw["goalId"], "date": raw["date"],
            "amount": r2(amount), "ts": int(raw.get("ts") or datetime.now().timestamp() * 1000)}, None


# ------------------------------------------------------------------ progress maths (mirrors goalStats in app.js)
def goal_stats(g: dict, logs: list[dict], today: date) -> dict:
    by_date: dict[str, float] = {}
    total = 0.0
    for l in logs:
        if l["goalId"] == g["id"]:
            by_date[l["date"]] = by_date.get(l["date"], 0) + l["amount"]
            total += l["amount"]
    days = g["days"]
    target = float(days if g["type"] == "daily" else g["target"])
    done = float(sum(1 for v in by_date.values() if v > 0)) if g["type"] == "daily" else total
    start = date.fromisoformat(g["start"])
    end = start + timedelta(days=days - 1)
    started, ended = today >= start, today > end
    elapsed = 0 if not started else min(days, (today - start).days + 1)
    days_left = 0 if ended else (days if not started else (end - today).days + 1)
    pct = min(1.0, done / target) if target > 0 else 0.0
    delta = done - target * elapsed / days
    remaining = max(0.0, target - done)
    need = remaining / days_left if days_left > 0 else remaining
    if done >= target:
        status, text = "done", "Completed"
    elif not started:
        status, text = "idle", f"Starts in {(start - today).days}d"
    elif ended:
        status, text = "behind", f"Ended, {r2(remaining)} short"
    elif delta >= 1:
        status, text = "ahead", f"Ahead by {math.floor(delta)}"
    elif delta > -1:
        status, text = "on", "On track"
    else:
        status, text = "behind", f"Behind by {math.ceil(-delta)}"
    return {
        "done": r2(done), "target": r2(target), "percent": round(pct * 1000) / 10, "status": status,
        "statusText": text, "remaining": r2(remaining), "needPerDay": r2(need), "daysLeft": days_left,
        "end": end.isoformat(), "streak": streak_of(by_date, today), "todayAmount": r2(by_date.get(today.isoformat(), 0)),
        "active": started and not ended,
    }


def streak_of(by_date: dict, today: date) -> int:
    d = today
    if by_date.get(d.isoformat(), 0) <= 0:
        d -= timedelta(days=1)
    n = 0
    while by_date.get(d.isoformat(), 0) > 0:
        n += 1
        d -= timedelta(days=1)
    return n


# ------------------------------------------------------------------ the store (one JSON file)
class Store:
    def __init__(self, path: Optional[Path] = None, today: Optional[date] = None):
        self.path = Path(path) if path else default_path()
        self._today = today

    @property
    def today(self) -> date:
        return self._today or date.today()

    def exists(self) -> bool:
        return self.path.exists()

    def load(self) -> dict:
        if not self.path.exists():
            return normalize_store({})
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise HabitError(f"{self.path} is not valid JSON ({e}). Fix or replace the file.")
        if not isinstance(raw, dict):
            raise HabitError(f"{self.path} must contain a JSON object")
        ver = raw.get("schemaVersion", raw.get("version", 1))
        if isinstance(ver, int) and ver > SCHEMA_VERSION:
            raise HabitError(f"file is schemaVersion {ver}; this server understands up to {SCHEMA_VERSION}")
        return normalize_store(raw)

    def save(self, store: dict) -> None:
        """Atomic write in the standard v2 format (so the app can import it). Keeps a .bak of the old file."""
        payload = {
            "app": "habit-tracker", "schemaVersion": SCHEMA_VERSION,
            "exportedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "today": self.today.isoformat(), "categories": store["categories"], "settings": store["settings"],
            "goals": [dict(g, end=(date.fromisoformat(g["start"]) + timedelta(days=g["days"] - 1)).isoformat(),
                           summary=self._summary(g, store["logs"])) for g in store["goals"]],
            "logs": sorted(store["logs"], key=lambda l: (l["date"], l["ts"])),
            "boards": store.get("boards", []),
            "tasks": store.get("tasks", []),
        }
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            (self.path.with_suffix(self.path.suffix + ".bak")).write_bytes(self.path.read_bytes())
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".habit-", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            os.replace(tmp, self.path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    def _summary(self, g: dict, logs: list[dict]) -> dict:
        s = goal_stats(g, logs, self.today)
        return {k: s[k] for k in ("done", "target", "percent", "status", "remaining", "needPerDay", "daysLeft", "streak", "todayAmount")}

    # ---------------------------------------------------------- lookups
    def find_goal(self, store: dict, ref: str) -> dict:
        ref = (ref or "").strip()
        if not ref:
            raise HabitError("goal is required (a goal name or id)")
        for g in store["goals"]:
            if g["id"] == ref:
                return g
        low = ref.lower()
        exact = [g for g in store["goals"] if g["name"].lower() == low]
        if len(exact) == 1:
            return exact[0]
        part = [g for g in store["goals"] if low in g["name"].lower()]
        if len(part) == 1:
            return part[0]
        pool = exact or part
        if len(pool) > 1:
            raise HabitError(f"'{ref}' matches several goals: " + "; ".join(f"{g['name']} (id {g['id']})" for g in pool) + ". Use the id.")
        names = ", ".join(g["name"] for g in store["goals"]) or "none yet"
        raise HabitError(f"No goal matches '{ref}'. Existing goals: {names}")

    def describe(self, store: dict, g: dict) -> dict:
        s = goal_stats(g, store["logs"], self.today)
        cat = next((c for c in store["categories"] if c["id"] == g["category"]), None)
        return {
            "id": g["id"], "name": g["name"], "icon": g["icon"], "type": g["type"],
            "category": g["category"], "categoryLabel": cat["label"] if cat else g["category"],
            "priority": g["priority"], "visibility": g["visibility"], "unit": g["unit"],
            "start": g["start"], "end": s["end"], "days": g["days"],
            "progress": f"{s['done']} / {s['target']} {('days' if g['type'] == 'daily' else g['unit'])}".strip(),
            "percent": s["percent"], "status": s["status"], "statusText": s["statusText"],
            "remaining": s["remaining"], "needPerDay": s["needPerDay"], "daysLeft": s["daysLeft"],
            "streak": s["streak"], "todayAmount": s["todayAmount"], "active": s["active"],
            "quickAddAmount": g["step"] if g["type"] == "total" else 1,
        }

    # ---------------------------------------------------------- operations (each one loads, changes, saves)
    def list_goals(self, category=None, priority=None, status=None, active_only=False) -> list[dict]:
        store = self.load()
        out = [self.describe(store, g) for g in store["goals"]]
        if category:
            out = [g for g in out if category.lower() in (g["category"].lower(), g["categoryLabel"].lower())]
        if priority:
            out = [g for g in out if g["priority"] == priority.lower()]
        if status:
            out = [g for g in out if g["status"] == status.lower()]
        if active_only:
            out = [g for g in out if g["active"]]
        return sorted(out, key=lambda g: (PRIORITIES[g["priority"]], g["name"].lower()))

    def get_goal(self, ref: str, recent_logs: int = 10) -> dict:
        store = self.load()
        g = self.find_goal(store, ref)
        logs = sorted((l for l in store["logs"] if l["goalId"] == g["id"]), key=lambda l: (l["date"], l["ts"]), reverse=True)
        d = self.describe(store, g)
        d["recentLogs"] = [{"id": l["id"], "date": l["date"], "amount": l["amount"]} for l in logs[:recent_logs]]
        return d

    def create_goal(self, **kw) -> dict:
        store = self.load()
        if not kw.get("start"):
            kw["start"] = self.today.isoformat()
        if kw.get("kind") and not kw.get("type"):
            kw["type"] = kw.pop("kind")
        kw.pop("kind", None)
        goal, errs = make_goal(kw, {c["id"] for c in store["categories"]})
        if errs:
            raise HabitError("Cannot create goal: " + "; ".join(errs))
        cat_in = (kw.get("category") or "").strip()
        if cat_in and goal["category"] == "other" and cat_in.lower() not in ("other",):
            match = next((c for c in store["categories"] if c["label"].lower() == cat_in.lower()), None)
            if match:
                goal["category"] = match["id"]
            else:
                raise HabitError(f"Unknown category '{cat_in}'. Existing: {', '.join(c['id'] for c in store['categories'])}. Use add_category first.")
        if any(g["name"].lower() == goal["name"].lower() for g in store["goals"]):
            raise HabitError(f"A goal named '{goal['name']}' already exists")
        store["goals"].append(goal)
        self.save(store)
        return self.describe(store, goal)

    def log_progress(self, ref: str, amount=None, on: Optional[str] = None) -> dict:
        store = self.load()
        g = self.find_goal(store, ref)
        day = parse_date(on) if on else self.today
        if day is None:
            raise HabitError("date must be YYYY-MM-DD")
        if day > self.today:
            raise HabitError("date is in the future; you can only log up to today")
        if day < date.fromisoformat(g["start"]):
            raise HabitError(f"date is before the goal starts ({g['start']})")
        if g["type"] == "daily":
            if any(l["goalId"] == g["id"] and l["date"] == day.isoformat() for l in store["logs"]):
                d = self.describe(store, g); d["message"] = f"Already marked done for {day}; nothing changed."
                return d
            amt = 1
        else:
            amt = float(g["step"] if g["type"] == "total" else 1) if amount is None else amount
        before = goal_stats(g, store["logs"], self.today)["status"]
        log, err = make_log({"goalId": g["id"], "date": day.isoformat(), "amount": amt}, {g["id"]})
        if err:
            raise HabitError(f"Cannot log: {err}")
        store["logs"].append(log)
        self.save(store)
        d = self.describe(store, g)
        d["loggedAmount"] = log["amount"]; d["logId"] = log["id"]
        d["message"] = f"Logged {log['amount']} for {g['name']} on {day}. Now {d['progress']} ({d['percent']}%), {d['statusText']}."
        if d["status"] == "done" and before != "done":
            d["message"] += " Goal completed!"
        return d

    def undo_last_log(self, ref: str) -> dict:
        store = self.load()
        g = self.find_goal(store, ref)
        mine = [l for l in store["logs"] if l["goalId"] == g["id"]]
        if not mine:
            raise HabitError(f"'{g['name']}' has no logs to undo")
        # newest = latest timestamp; if two share a millisecond, the one added last wins
        last = max(enumerate(mine), key=lambda p: (p[1]["ts"], p[0]))[1]
        store["logs"] = [l for l in store["logs"] if l["id"] != last["id"]]
        self.save(store)
        d = self.describe(store, g)
        d["message"] = f"Removed the log of {last['amount']} on {last['date']}. Now {d['progress']}."
        return d

    def update_goal(self, ref: str, **changes) -> dict:
        store = self.load()
        g = self.find_goal(store, ref)
        merged = dict(g)
        for k, v in changes.items():
            if v is not None:
                merged[k] = v
        cat_ids = {c["id"] for c in store["categories"]}
        if changes.get("category") and changes["category"] not in cat_ids:
            m = next((c for c in store["categories"] if c["label"].lower() == str(changes["category"]).lower()), None)
            if not m:
                raise HabitError(f"Unknown category '{changes['category']}'. Existing: {', '.join(sorted(cat_ids))}")
            merged["category"] = m["id"]
        goal, errs = make_goal(merged, cat_ids)
        if errs:
            raise HabitError("Cannot update goal: " + "; ".join(errs))
        g.clear(); g.update(goal)
        self.save(store)
        return self.describe(store, g)

    def add_category(self, label: str, icon: str = "🏷", color: str = "#0ea5e9") -> dict:
        store = self.load()
        label = (label or "").strip()[:24]
        if not label:
            raise HabitError("label is required")
        if not re.match(r"^#[0-9a-fA-F]{6}$", color or ""):
            raise HabitError("color must look like #0ea5e9")
        if any(c["label"].lower() == label.lower() for c in store["categories"]):
            raise HabitError(f"Category '{label}' already exists")
        cid = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "cat"
        if any(c["id"] == cid for c in store["categories"]):
            cid += "-" + new_id()[:3]
        cat = {"id": cid, "label": label, "icon": (icon or "🏷")[:4], "color": color}
        store["categories"].append(cat)
        self.save(store)
        return cat

    # ---------------------------------------------------------- summaries
    def today_summary(self) -> dict:
        store = self.load()
        goals = [self.describe(store, g) for g in store["goals"]]
        active = [g for g in goals if g["active"]]
        logged = [g for g in active if g["todayAmount"] > 0]
        todo = sorted((g for g in active if g["todayAmount"] <= 0), key=lambda g: (PRIORITIES[g["priority"]], g["name"].lower()))
        return {
            "date": self.today.isoformat(), "activeGoals": len(active), "loggedToday": len(logged),
            "stillToDoToday": [{"name": g["name"], "priority": g["priority"], "needPerDay": g["needPerDay"], "type": g["type"],
                                "quickAddAmount": g["quickAddAmount"], "statusText": g["statusText"]} for g in todo],
            "doneToday": [{"name": g["name"], "todayAmount": g["todayAmount"]} for g in logged],
            "behindPace": [g["name"] for g in active if g["status"] == "behind"],
        }

    def weekly_review(self, days: int = 7) -> dict:
        days = max(1, min(int(days), 90))
        store = self.load()
        since = (self.today - timedelta(days=days - 1)).isoformat()
        rows = []
        for g in store["goals"]:
            d = self.describe(store, g)
            recent = [l for l in store["logs"] if l["goalId"] == g["id"] and l["date"] >= since]
            rows.append({"name": g["name"], "priority": g["priority"], "daysActive": len({l["date"] for l in recent}),
                         "amountInPeriod": r2(sum(l["amount"] for l in recent)), "percent": d["percent"],
                         "statusText": d["statusText"], "streak": d["streak"]})
        rows.sort(key=lambda r: (PRIORITIES[r["priority"]], r["name"].lower()))
        return {"periodDays": days, "from": since, "to": self.today.isoformat(), "goals": rows,
                "needsAttention": [r["name"] for r in rows if r["daysActive"] == 0 and r["percent"] < 100]}
