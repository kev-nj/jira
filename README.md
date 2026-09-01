# Jira Board

A single-page kanban board. No build step, no backend — all data lives in the browser's `localStorage`
under the key `jira-board.v1`.

## Features
- Four columns: To Do, In Progress, In Review, Done
- Create / edit / delete issues (type, priority, status, story points, assignee, labels)
- Due date **and** time per task, with Today / Tomorrow / overdue chips
- Live clock and a running "N due today · N overdue" count in the header
- **Due today** filter for working the day, and inline quick-add per column
- Dated tasks sort to the top of their column, soonest first
- Drag and drop between and within columns, with order preserved
- Search + filter by assignee, type, priority
- Export / import the board as JSON, load sample data, clear the board
- Light and dark theme following the OS setting
- `c` opens the create dialog, `Esc` closes it

## Run locally
Open `index.html` directly, or serve it:

    python3 -m http.server 8000

## Deploy to GitHub Pages
1. Push these files to the repository root on `main`.
2. Settings → Pages → Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
3. The board appears at `https://<user>.github.io/<repo>/`.

## Notes
Data is per-browser and per-origin: it does not sync between devices, and clearing site data erases
the board. Use **Export JSON** to keep a backup.
