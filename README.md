# To-Do Board

A kanban-style planner for daily to-dos. No build step, no backend — everything lives in the
browser's `localStorage` under `todo-board.v2`.

## Views
- **Day** — three status columns (To Do / In Progress / Done), each split into **Project** and
  **Non-project** sections. A toolbar button moves the day's unfinished tasks to the next day.
- **Work** — Monday–Friday only; rolling Friday's leftovers skips the weekend and lands on Monday.
- **Week** — Monday–Sunday columns, each with both sections and its own rollover button (`↦`).
- **Month** — calendar grid; click a date number to open that day.

## Tasks
- Title, notes, section, project, **assignee**, date, time, status, priority
- **Subtasks** with their own checkboxes; cards show `2/3` progress and expand inline
- Tick the checkbox on a card to complete it; drag cards between columns, sections, and days
- Quick-add inputs per section for fast capture

## Rollover
- Per-day: "Move N unfinished to tomorrow" in Day view, `↦` per column in Week view
- Global: **Pull overdue into today** in the `⋯` menu
- Rolled tasks are marked with `↦` and remember the day they came from

## Keyboard
`1` `2` `3` `4` switch views · `←` `→` move through time · `t` jump to today · `n` new task ·
`Space` toggle done on a focused card · `Esc` close the dialog

## Run locally
Open `index.html`, or serve it with `python3 -m http.server 8000`. Note that `file://` and
`localhost` have separate localStorage, so pick one.

## Deploy to GitHub Pages
Push to `main`, then Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

## Notes
Data is per-browser and per-origin; it does not sync between devices. Use **Export JSON** to back it
up. Tasks from the earlier `jira-board.v1` board are migrated automatically on first load.
