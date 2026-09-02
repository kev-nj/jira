# To-Do Board

A kanban-style planner for daily to-dos. No build step, no backend — everything lives in the
browser's `localStorage` under `todo-board.v2`.

## Views
- **Day** — three status columns (To Do / In Progress / Done), each split into your **sections**
  (Project and Non-project by default). A toolbar button moves the day's unfinished tasks
  to the next day.
- **Work** — Monday–Friday only; rolling Friday's leftovers skips the weekend and lands on Monday.
- **Week** — Monday–Sunday columns, each with both sections and its own rollover button (`↦`).
- **Month** — calendar grid; click a date number to open that day.

## Sections
Sections are yours to define. Double-click a section heading on the board to rename it in place,
or open `⋯ → Sections…` to add, reorder, and delete them. Deleting a section that holds tasks
asks where to move that work first — nothing is discarded silently.

## Tasks
- Title, notes, section, project, **assignee**, date, time, status, priority
- **Subtasks** with their own checkboxes; cards show `2/3` progress and expand inline
- Tick the checkbox on a card to complete it; drag cards between columns, sections, and days
- Quick-add inputs per section for fast capture
- **Favourites** (★) sort to the top and can be filtered on
- **Drag to rearrange** within a section; an insertion line shows where the card lands.
  Manual order is the default; `⋯ → Sort by time` orders each day by clock time instead,
  and dragging a card switches back to manual.

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

## Sync across devices (Supabase)
The board runs fine signed out — localStorage remains the source of truth, so it works offline.
Signing in adds a synced copy in Supabase.

**How it works:** every save stamps `updatedAt` and pushes to Supabase 0.8s after edits settle.
On load, the local and remote copies are compared and the more recent one wins. Storage is one
`boards` row per user (`user_id`, `data` jsonb, `updated_at`), protected by row-level security —
each policy is scoped to `auth.uid() = user_id`, so the publishable key in `cloud.js` grants
access to nothing on its own.

**One-time setup (GitHub OAuth):**
1. GitHub → Settings → Developer settings → OAuth Apps → **New OAuth App**
   - Homepage URL: `https://kev-nj.github.io/jira/`
   - Authorization callback URL: `https://ekfgbqxkqidgsnzzqvkh.supabase.co/auth/v1/callback`
2. Copy the Client ID, generate a Client Secret.
3. Supabase dashboard → Authentication → Providers → **GitHub** → enable, paste both, save.
4. Supabase dashboard → Authentication → URL Configuration:
   - Site URL: `https://kev-nj.github.io/jira/`
   - Additional redirect URLs: add `http://localhost:8000` for local testing.

## Notes
Data is per-browser and per-origin; it does not sync between devices. Use **Export JSON** to back it
up. Tasks from the earlier `jira-board.v1` board are migrated automatically on first load.
