# Habit Tracker MCP server

Lets an AI chat read and update your habits: "I did 30 push-ups", "what is left today?", "create a goal to read daily for 30 days".

```
Ollama model  <-->  MCP client (ollmcp / Open WebUI / ...)  <-->  this server  <-->  habit-data.json  <-->  web app
                                                                                       (Export / Import)
```

The web app keeps its data inside the browser, which no other program can read. So the shared meeting point is the
**same JSON file the app exports and imports** (format: `../docs/data-format.md`).

## 1. Install (once)
```bash
cd ~/Desktop/Learn/habit-tracker/mcp-server
/opt/homebrew/bin/python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
```
(Python 3.10+ is needed; the system Python 3.9 is too old.)

## 2. Choose the data file
Default: `mcp-server/data/habit-data.json` (git-ignored). Override with the `HABIT_DATA` environment variable.

- **App -> server:** in the app go to Backup -> Export backup (JSON), then copy/rename the downloaded file to the data path.
- **Server -> app:** in the app go to Backup -> Import backup and pick the same file. The server keeps a `.bak` copy of
  the previous file every time it writes.
- No file yet? The server starts empty and creates it on the first `create_goal`.

Remember: the app and the file are separate copies. After the AI changes the file, **import it into the app** to see the changes;
after you change things in the app, **export again** so the AI sees them. Importing replaces the app's data.

## 3. Tools the AI gets
| Tool | What it does |
|---|---|
| `today_summary` | what is done, what is left (highest priority first), what is behind pace |
| `list_goals` | all goals with progress; filter by category, priority, status, active_only |
| `get_goal` | one goal in detail + recent logs |
| `create_goal` | new goal: `kind` = `daily` / `times` / `total`, plus target, unit, days, category, priority, visibility |
| `log_progress` | record progress by goal name (amount optional: daily = done, times = 1, total = quick-add amount) |
| `undo_last_log` | remove the most recent log of a goal |
| `update_goal` | change priority, category, visibility, target, days, step, unit, icon, name |
| `list_categories`, `add_category` | read and add categories |
| `weekly_review` | per-goal activity over the last N days + goals needing attention |
| `data_file_info` | where the file is and how big it is |

Things it will refuse (with a clear message): unknown or ambiguous goal names, logging in the future or before a goal's start,
a second "done" for a daily goal on the same day, invalid goals (same rules as the web app).

Boards and tasks created in the web app are kept intact: the server does not edit them, but it writes them back unchanged
whenever it saves, so an AI logging a habit never deletes your boards. (Task tools for the AI could be added later.)

## 4. Check that it works
```bash
./.venv/bin/python -m unittest discover -s tests -v    # unit tests, including a parity test against the real app.js
./.venv/bin/python tests/e2e_stdio.py                  # starts the server and talks to it like an AI client (temp data file)
```
Handy visual inspector (optional): `./.venv/bin/mcp dev server.py`

## 5. Connect it to a client

The server config is the same everywhere (use your real paths):
```json
{
  "mcpServers": {
    "habit-tracker": {
      "command": "/Users/U1131606/Desktop/Learn/habit-tracker/mcp-server/.venv/bin/python",
      "args": ["/Users/U1131606/Desktop/Learn/habit-tracker/mcp-server/server.py"],
      "env": { "HABIT_DATA": "/Users/U1131606/Desktop/Learn/habit-tracker/mcp-server/data/habit-data.json" }
    }
  }
}
```

### With Ollama
Ollama only runs the model; it does not speak MCP by itself. You need an MCP-capable client in front of it, and a model that
supports **tool calling** (for example `qwen2.5`, `llama3.1`, `mistral-nemo`; check with `ollama show <model>`).
Two common ways (see each project's docs for the exact current flags):
1. **ollmcp** (MCP client for Ollama, terminal): `pip install ollmcp` (or `uvx ollmcp`), save the JSON above as `habit-mcp.json`,
   then run `ollmcp --servers-json habit-mcp.json --model qwen2.5:7b`. Run `ollmcp --help` to confirm options.
2. **Open WebUI + mcpo**: `uvx mcpo --port 8001 -- <command> <args...>` (the same command/args as above) exposes the server
   as a tool server; add `http://localhost:8001` under Open WebUI -> Settings -> Tools, then pick your Ollama model.

### With Claude Desktop (to test it quickly)
Add the JSON above to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart Claude Desktop.

### macOS note
If a client says it cannot read the file, macOS may be blocking access to the Desktop folder for that app.
Either grant the app access (System Settings -> Privacy & Security -> Files and Folders) or point `HABIT_DATA`
to a folder outside Desktop/Documents, e.g. `~/habit-data/habit-data.json`.

## Try these prompts
- "What's left for me to do today?"
- "I did 30 push-ups." / "Mark meditation done."
- "Create a daily goal 'Read 20 pages' for 30 days in Learning, low priority."
- "Which goals am I behind on? Give me a weekly review."
- "Oops, undo the last push-ups entry."

## Design notes
- The file is the single source of truth; every tool call re-reads it, so edits you make between calls are never overwritten.
- Writes are atomic (temp file + rename) and the previous version is kept as `habit-data.json.bak`.
- The progress maths mirrors `app.js`, and `tests/test_core.py` proves it by running the real `app.js` in Node on the same data.
