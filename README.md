# Habit Tracker (Phase 1 - solo)

A static, mobile-friendly habit and goal tracker. No server, no database, no build step.
Your data is stored in your browser (localStorage). Use Backup -> Export to save a JSON file.

## Files
- `index.html` - page shell
- `style.css`  - styles (light + dark mode)
- `app.js`     - all the logic (goals, logging, charts)
- `sw.js`, `manifest.webmanifest`, `icon.svg` - make it installable on a phone

## Goal types
- **Total amount** - e.g. 500 push-ups in 60 days. Tap the quick-add button (+20) or "custom".
- **Number of times** - e.g. 11 workouts. Each tap logs one.
- **Daily habit** - once a day, tracks streaks.

## New in Phase 2 (priorities and categories)
- **Priority** per goal (High / Medium / Low). Tap the priority chip on any goal to cycle it.
- **Group by** Category or Priority, and **Order** by Priority first or My order (Today and Goals tabs).
- **Reorder** (Goals tab): move goals up/down with the arrow buttons; this sets "My order".
- **Your own categories**: Goals tab -> Categories (rename, change icon/color, add, delete),
  or pick "New category" when creating a goal.
- Old Phase 1 backups still import: missing priorities become Medium.

## Run it on your computer
Opening index.html directly works for most things. For the full experience:
```
cd habit-tracker
python3 -m http.server 8000
```
then open http://localhost:8000

## Put it on GitHub Pages (free)
1. Create a new GitHub repo (e.g. `habit-tracker`) and upload all files in this folder to its root.
2. Repo -> Settings -> Pages -> Source: "Deploy from a branch" -> Branch: `main`, folder `/ (root)` -> Save.
3. After a minute your site is at `https://YOUR_USER.github.io/habit-tracker/`.
4. On your phone open that link, then "Add to Home Screen" to install it like an app.

## Good to know
- Data is per browser/device. To move to another phone: Backup -> Export, then Import there.
- Clearing browser data deletes your goals, so export now and then.
- The public/private toggle is saved already, but sharing with friends arrives in Phase 2.

## Roadmap
- Phase 2: friends + accountability (publish only public goals to a JSON file on GitHub)
- Phase 3: reminders, weekly summary cards, badges
