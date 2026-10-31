"""End-to-end check: start server.py over stdio and use it like an AI client would.

Run (from the mcp-server folder):  .venv/bin/python tests/e2e_stdio.py
Uses a temporary data file, so your real data is never touched.
"""
import asyncio
import json
import sys
import tempfile
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parent.parent


def show(label, res):
    text = "".join(getattr(c, "text", "") for c in res.content)
    print(f"\n--- {label}  (isError={res.is_error})\n{text[:700]}")
    return res


async def main():
    data = Path(tempfile.mkdtemp()) / "habit-data.json"
    params = StdioServerParameters(command=sys.executable, args=[str(ROOT / "server.py")], env={"HABIT_DATA": str(data)})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as s:
            await s.initialize()
            tools = await s.list_tools()
            print("TOOLS:", ", ".join(t.name for t in tools.tools))
            show("data_file_info (no file yet)", await s.call_tool("data_file_info", {}))
            show("create_goal push-ups", await s.call_tool("create_goal", {"name": "Push-ups", "kind": "total", "target": 500, "unit": "push-ups", "step": 20, "days": 60, "category": "health", "priority": "high"}))
            show("create_goal daily", await s.call_tool("create_goal", {"name": "Meditate", "kind": "daily", "days": 30, "category": "mind"}))
            show("log_progress push-ups (default amount)", await s.call_tool("log_progress", {"goal": "push"}))
            r = show("log_progress meditate", await s.call_tool("log_progress", {"goal": "Meditate"}))
            show("today_summary", await s.call_tool("today_summary", {}))
            bad = show("log_progress unknown goal (should be a clean error)", await s.call_tool("log_progress", {"goal": "swim"}))
            bad2 = show("create_goal invalid (should be a clean error)", await s.call_tool("create_goal", {"name": "", "kind": "times", "target": 0}))
            assert bad.is_error and bad2.is_error, "errors must be reported as tool errors"
            assert not r.is_error
    saved = json.loads(data.read_text())
    print("\nFILE:", {"schemaVersion": saved["schemaVersion"], "goals": len(saved["goals"]), "logs": len(saved["logs"])})
    assert saved["schemaVersion"] == 2 and len(saved["goals"]) == 2 and len(saved["logs"]) == 2
    print("E2E OK")


asyncio.run(main())
