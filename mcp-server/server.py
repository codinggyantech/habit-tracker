"""Habit Tracker MCP server (stdio).

Lets an AI chat (Ollama via an MCP client, Claude Desktop, ...) read and update your habit data.
The data lives in one JSON file - the same file the web app exports/imports. See README.md.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent))

from mcp.server.mcpserver import MCPServer  # noqa: E402
from mcp.server.mcpserver.exceptions import ToolError  # noqa: E402

import habit_core as core  # noqa: E402

INSTRUCTIONS = """\
You manage the user's habit/goal tracker. Goal kinds:
- daily: a habit done once per day (target = every day of the duration).
- times: custom target, do something N times (each log adds 1).
- total: custom target, reach a total amount (each log adds an amount, e.g. 20 push-ups).
Call today_summary first to see what is left to do. To record progress use log_progress with the goal name
(amount is optional: daily=done, times=1, total=the goal's quick-add amount). Never invent goals; if a
goal name is ambiguous the tool error lists the candidates. Dates are YYYY-MM-DD.
"""

mcp = MCPServer("habit-tracker", instructions=INSTRUCTIONS)
store = core.Store()


def _run(fn, *a, **kw):
    """Turn expected problems into ToolError so the AI sees the helpful message (other exceptions are masked)."""
    try:
        return fn(*a, **kw)
    except core.HabitError as e:
        raise ToolError(str(e)) from None


@mcp.tool()
def data_file_info() -> dict:
    """Where the habit data file is, whether it exists, and how many goals/logs it has."""
    data = _run(store.load)
    return {"path": str(store.path), "exists": store.exists(), "goals": len(data["goals"]),
            "logs": len(data["logs"]), "categories": [c["id"] for c in data["categories"]],
            "tip": None if store.exists() else "No file yet. Export from the app (Backup > Export JSON) and put it at this path, or create_goal to start fresh."}


@mcp.tool()
def list_categories() -> list[dict]:
    """List goal categories (id, label, icon, color)."""
    return _run(store.load)["categories"]


@mcp.tool()
def list_goals(category: Optional[str] = None, priority: Optional[str] = None,
               status: Optional[str] = None, active_only: bool = False) -> list[dict]:
    """List goals with progress, sorted by priority. Filters: category (id or label), priority (high|medium|low),
    status (ahead|on|behind|done|idle), active_only (only goals running today)."""
    return _run(store.list_goals, category, priority, status, active_only)


@mcp.tool()
def get_goal(goal: str, recent_logs: int = 10) -> dict:
    """Full details and the most recent log entries for one goal (name or id)."""
    return _run(store.get_goal, goal, recent_logs)


@mcp.tool()
def today_summary() -> dict:
    """What is done today, what is still to do (highest priority first), and which goals are behind pace."""
    return _run(store.today_summary)


@mcp.tool()
def weekly_review(days: int = 7) -> dict:
    """Activity over the last N days (default 7) per goal, plus goals that need attention."""
    return _run(store.weekly_review, days)


@mcp.tool()
def create_goal(name: str, kind: str, target: Optional[float] = None, days: int = 30,
                unit: str = "", step: Optional[float] = None, start: Optional[str] = None,
                category: str = "other", priority: str = "medium", visibility: str = "private",
                icon: str = "🎯") -> dict:
    """Create a goal in the standard format.
    kind: 'daily' (habit every day, no target needed), 'times' (do it N times; target = N),
    or 'total' (reach an amount; target = amount, unit e.g. 'push-ups', step = quick-add amount).
    days = duration (1-730), start = YYYY-MM-DD (default today), category = existing category id/label,
    priority = high|medium|low, visibility = private|public."""
    return _run(store.create_goal, name=name, kind=kind, target=target, days=days, unit=unit, step=step,
                start=start, category=category, priority=priority, visibility=visibility, icon=icon)


@mcp.tool()
def log_progress(goal: str, amount: Optional[float] = None, date: Optional[str] = None) -> dict:
    """Record progress on a goal (name or id). amount is optional: daily goals = done for the day,
    times goals = 1, total goals = the goal's quick-add amount. date defaults to today (YYYY-MM-DD, not in the future)."""
    return _run(store.log_progress, goal, amount, date)


@mcp.tool()
def undo_last_log(goal: str) -> dict:
    """Remove the most recent log entry of a goal (use after a mistake)."""
    return _run(store.undo_last_log, goal)


@mcp.tool()
def update_goal(goal: str, name: Optional[str] = None, priority: Optional[str] = None,
                category: Optional[str] = None, visibility: Optional[str] = None,
                target: Optional[float] = None, days: Optional[int] = None, step: Optional[float] = None,
                unit: Optional[str] = None, icon: Optional[str] = None) -> dict:
    """Change fields of an existing goal. Only the fields you pass are changed. Type and start date cannot be changed."""
    return _run(store.update_goal, goal, name=name, priority=priority, category=category,
                visibility=visibility, target=target, days=days, step=step, unit=unit, icon=icon)


@mcp.tool()
def add_category(label: str, icon: str = "🏷", color: str = "#0ea5e9") -> dict:
    """Add a new goal category (color like #0ea5e9)."""
    return _run(store.add_category, label, icon, color)


if __name__ == "__main__":
    mcp.run(transport="stdio")
