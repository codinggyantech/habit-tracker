# Plan files (Boards > Import plan / tasks)

A plan adds **boards**, **tasks** and optional **starter habits** to the app. Importing *adds* to what you have and skips tasks
and habits that already exist, so it is safe to import twice.

Ready-made plan: `plans/60-day-master-plan.json` (and the same tasks as `plans/60-day-master-plan.csv`).
It is generated from `tools/plan_content.py` by `python3 tools/make_plan_files.py` and matches `60_Day_Master_Plan.xlsx`.

## JSON
```json
{
  "app": "habit-tracker", "type": "plan", "schemaVersion": 1,
  "name": "60-Day Master Plan", "startDate": "2026-11-01",
  "boards": [
    { "name": "Health", "icon": "💪", "color": "#16a34a", "category": "health",
      "tasks": [ { "day": 1, "title": "Baseline test", "minutes": 45, "priority": "medium" } ] }
  ],
  "habits": [ { "name": "500 push-ups", "type": "total", "target": 500, "unit": "push-ups", "step": 20, "days": 60, "category": "health", "priority": "high", "icon": "💪" } ]
}
```
- A task's due date is `due` (YYYY-MM-DD) if given, otherwise `startDate + day - 1`. You choose the start date when importing.
- A board that already exists (same name) receives the new tasks; otherwise it is created.
- `habits` use the standard goal format (see `data-format.md`) and are created from the chosen start date.

## CSV (edit it in Excel or Google Sheets)
```
board,day,due,title,minutes,priority,notes
Health,1,,"Baseline test, then log it",45,medium,
,,2026-11-05,Pay rent,5,low,
```
- Column `title` is required; the others are optional. A blank `board` goes to the **Inbox**.
- `day` or `due` sets the due date. `status` (todo/doing/done) is also understood.
- Commas and quotes inside a cell are handled when the cell is quoted, as spreadsheets do automatically.

## Exporting
Backup > **Export tasks (CSV)** gives `board,title,status,due,minutes,priority,notes`. Backup > **Export backup (JSON)** includes boards and tasks too.
