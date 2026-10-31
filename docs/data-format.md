# Habit Tracker data format (schemaVersion 3)

This is the one standard used by the app's **Export / Import**, and by the **MCP server**.
A machine-readable version is in `habit-data.schema.json`.

## File layout
```json
{
  "app": "habit-tracker",
  "schemaVersion": 3,
  "exportedAt": "2026-10-31T15:30:00.000Z",
  "today": "2026-10-31",
  "categories": [ { "id": "health", "label": "Health", "icon": "💪", "color": "#16a34a" } ],
  "settings": { "sort": "priority", "group": "category" },
  "goals": [ { "...": "see below" } ],
  "logs":  [ { "id": "ab12", "goalId": "g1", "date": "2026-10-31", "amount": 20, "ts": 1793460000000 } ],
  "boards": [ { "id": "inbox", "name": "Inbox", "icon": "📥", "color": "#64748b", "category": "" } ],
  "tasks":  [ { "id": "t1", "boardId": "inbox", "title": "Call the electrician", "status": "todo", "priority": "medium",
                "due": "", "minutes": 0, "focus": "2026-10-31", "notes": "", "createdAt": 1793460000000, "doneAt": "" } ]
}
```

## A goal
| Field | Type | Rules |
|---|---|---|
| `id` | string | unique; made for you if missing |
| `name` | string | required, max 60 chars |
| `type` | `daily` \| `times` \| `total` | see "Goal types" |
| `target` | number | must be > 0 for `times` and `total`; ignored (0) for `daily` |
| `unit` | string | for `total` only (e.g. "push-ups"); `times` always uses "times" |
| `step` | number > 0 | quick-add amount for `total`; always 1 otherwise |
| `days` | integer 1-730 | length of the goal |
| `start` | `YYYY-MM-DD` | first day; the goal ends on `start + days - 1` (`end` is exported for convenience) |
| `category` | string | a category `id`; unknown ids become `other` |
| `priority` | `high` \| `medium` \| `low` | default `medium` |
| `visibility` | `private` \| `public` | default `private` (used for sharing in a later phase) |
| `icon` | string | one emoji |
| `summary` | object | **read-only**, calculated on export, ignored on import |

## Goal types (what "custom" vs "daily habit" means)
- **`daily`** - a habit done once a day. Each day with a log counts as 1; the target is every day of `days`.
- **`times`** - custom target: do it N times (e.g. 11 workouts). Each log adds `amount` (normally 1).
- **`total`** - custom target: reach a total amount (e.g. 500 push-ups). Each log adds `amount`.

## A log
`{ "id", "goalId", "date": "YYYY-MM-DD", "amount": number > 0, "ts": epoch-millis }`.
For `daily` goals, any amount > 0 on a date means "done that day".

## A board and a task (new in version 3)
A **board** groups tasks (Health, Wealth, Home...). The **Inbox** board always exists and holds quick "anonymous" tasks.
`{ id, name (max 30), icon, color (#rrggbb), category }` - `category` optionally links the board to a habit category so its habits show on the board.

A **task**:
| Field | Rules |
|---|---|
| `id` | unique; made for you if missing |
| `boardId` | an existing board id; unknown ids fall back to `inbox` |
| `title` | required, max 120 chars |
| `status` | `todo` \| `doing` \| `done` (default `todo`) |
| `priority` | `high` \| `medium` \| `low` (default `medium`) |
| `due` | `YYYY-MM-DD` or empty |
| `minutes` | 0-1440 |
| `focus` | a date; the task is in "Focus today" when it equals today |
| `notes` | max 500 chars |
| `createdAt`, `doneAt` | epoch millis / date; filled in for you |

Plan files (JSON or CSV) that create boards and tasks are described in `plan-format.md`.

## Import rules
- The file must have `goals` and `logs` arrays (`boards` and `tasks` are optional). Files from Phase 1 and version 2 (no `schemaVersion`, fields `cat`/`vis`) still import.
- Every goal and log is validated. Invalid ones are **skipped and reported** before you confirm.
- A file with a newer `schemaVersion` than the app understands is refused.
- Importing **replaces** the data in the app.

## Progress maths (same in the app and the MCP server)
- `done`: sum of log amounts (for `daily`: number of days with a log).
- `percent`: `done / target`, capped at 100%.
- `expected so far`: `target x daysElapsed / days`; `ahead` if done is at least 1 above it, `behind` if at least 1 below, otherwise `on track`.
- `needPerDay`: `remaining / daysLeft` (today included).
- `streak`: consecutive days with a log, ending today (or yesterday if nothing logged yet today).

## CSV export
`date,goal,category,type,amount,unit,priority` - one row per log, handy for spreadsheets.
