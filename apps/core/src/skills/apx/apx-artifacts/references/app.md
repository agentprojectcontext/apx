# Apps — skeleton and records

An app is an artifact that fills the window and is listed in Apps. Make one only when the owner asks for an app, or
the artifact must keep records the owner adds over time. A view of data, a chart or a form is a widget.

Declare it in the page with `<meta name="apx-surface" content="app">` (or `app: true` in `show_widget`). An app too
big to write by hand: [build.md](build.md).

## Build it as a project, all of it, in this turn

An app is built as files in `{{artifact_sources}}/<name>/` (see SKILL.md, "Two ways to make one"): every save of
`index.html` shows it and reports whether it started. The owner asked once and expects the whole app, not a shell to
fill in later.

1. **Plan.** Write `PLAN.md` in the folder: every view of the app (the sidebar's sections), what each shows and does,
   the tables and fields it keeps, and how you will know each works. Ask the owner (buttons) only what blocks the plan.
2. **Start from a layout.** Copy the starter that fits (below) to `index.html` with the shell, rename the app, set the
   sidebar's views from the plan, put your name in its "Made by" foot. Save: it must start without errors.
3. **Build every view, one after another, one save each at least.** The first save is only the shell. Then, for
   each view, a `file_edit` that gives it its real content (lists, forms, tables, charts on the owner's data), adding
   and editing records in `APX.db`, an empty state that says what to do and offers the action, deletes behind
   `APX.confirm`, its counts in the sidebar, its line in the status bar, and the inspector filled with the selected
   record's properties and actions. Each save's result lists every view and what it shows: a view that reads empty
   or only describes itself is not done. Tick it in `PLAN.md`.
4. **Do not stop halfway, and not at the first clean save.** "Started without errors" means it loads, not that it is
   done. No "coming soon", no empty section, no view that only says what it will do. Keep going until every view in
   the plan works and holds the starter's depth: rail, sidebar with counts, inspector, status bar. If you must stop (a question, the turn's limit), say what is done and what is
   next, so the next turn finishes it.
5. **Finish with a check.** The last save starts clean, its on-screen text shows real content, and you tell the owner
   in two lines what each view does.

## Start from a layout, never from a blank page

Every app starts from one of these pages: copy it whole (`cp "{{skill_dir}}/assets/<file>" …`, or read it with
`load_skill name=apx-artifacts file=assets/<file>`), then replace its sample sections, data and words with the
owner's. Keep its shell.

| Starter | For | Shell |
|---|---|---|
| [app-dashboard.html](../assets/app-dashboard.html) | Data the owner watches: metrics, reports, monitoring | rail · sidebar · top bar · views · inspector · status bar |
| [app-records.html](../assets/app-records.html) | Records the owner adds and edits: tasks, stock, contacts, expenses | rail · sidebar · top bar · list-detail · inspector · status bar, wired to `APX.db` |
| [app-simple.html](../assets/app-simple.html) | A small tool with a few views | sidebar · top bar · views · status bar |

What every app keeps, filled with real content:

- **Sidebar**: its navigation (`ax-nav`, sections with counts) and the foot "Made by" with your own name
  (`ax-agent`), so the owner sees who keeps it.
- **Top bar**: the view's title with a short subtitle, its controls, and one primary action.
- **Status bar**: one honest line: live or saved state, counts, last reading.
- **Rail** when the app has more than one top-level section; **inspector** for the selected item's properties or the
  last run. Drop one of these only when the app has nothing for it, not to save work.

Write the owner's language in the copy; the starters are in English only as samples. Check before you show it: it
looks like its starter (the same shell, now holding the owner's content), every view and button works, and its
memory follows the rules below.

## Layout

Two surfaces. **widget** (default): inline in the chat, padded, uses `main.ax-page`. **app**: full window, no padding,
no page scroll; each panel scrolls on its own. Declare it with `<meta name="apx-surface" content="app">` in the page
(APX then lists it in Apps, as `app: true` does). In app mode do not use `ax-page`; use this skeleton. Every widget
component works inside `ax-main__inner`.

```html
<div class="ax-app" data-ax-views>
  <nav class="ax-rail">…</nav>                <!-- optional: 56px icon bar -->
  <aside class="ax-sidebar" id="sb">…</aside> <!-- optional: navigation -->
  <div class="ax-shell">                      <!-- required center column -->
    <header class="ax-topbar">…</header>
    <main class="ax-main"><div class="ax-main__inner">…</div></main>
    <footer class="ax-statusbar">…</footer>   <!-- optional -->
  </div>
  <aside class="ax-aside" id="insp">…</aside> <!-- optional: right inspector -->
</div>
```

Valid combinations: shell only · sidebar + shell · rail + shell · rail + sidebar + shell · any + inspector · shell
with `ax-split` (list-detail).

| Piece | Classes and use |
|---|---|
| Rail | `nav.ax-rail` → `button.ax-rail__btn` (`aria-selected="true"`, `data-badge` dot, `data-ax-tip` tooltip) · `hr` separator · `ax-rail__spacer` pushes the rest down |
| Sidebar | `aside.ax-sidebar` → `__head` (title `b` + actions) · `__body` (scrolls) · `__foot` · `data-collapsed` hides it |
| Navigation | `ax-nav` → `button.ax-nav__item` (`ax-icon` + `span` + `em` counter + `ax-nav__act` hover action) · `--sub` indented · `--muted` · `aria-selected` / `aria-current=page` |
| Sections | `ax-section` (group title, may hold an `ax-iconbtn--sm`) · `details.ax-group` with `summary.ax-nav__item` + `ax-icon.chev` (collapsible) |
| Top bar | `header.ax-topbar` → `ax-topbar__title` (with `small` subtitle) + controls on the right |
| Content | `main.ax-main` → `ax-main__inner` (comfortable width, padded) · `ax-main--flush` no padding (for `ax-split`, `ax-board`) |
| Status bar | `footer.ax-statusbar` — one status line: `ax-live`, counts, `ax-ago` |
| Inspector | `aside.ax-aside` (`--w:320px`) → `__head` · `__body` · `data-collapsed` hides it |
| Icon button | `ax-iconbtn` (`--sm`, `aria-pressed`) — always with `data-ax-tip` |
| List-detail | `div.ax-split[data-ax-select]` (`--list:360px`) → `ax-split__list` (with `ax-split__tools` on top and `button.ax-listrow[data-id]` holding `b`, `small`, `em`, badge) + panels `[data-detail="id"]` with `ax-detail` |
| Popover | `div.ax-hover` > trigger + `div.ax-popover` (`__head`, `__row`, `hr`) — shows on hover/focus |
| Board | `ax-board` → `ax-col` (`__head` with `em` counter, `__body`) → `ax-tile` (`__foot`) |
| Settings | `ax-settings` → `ax-setgroup` (`h3`) → `ax-setrow` (text + `small` left, control right) |
| Empty | `ax-empty-app` — empty state centered in the whole area |

Behavior without JavaScript:

- **Views**: `data-ax-views` on a container; triggers `[data-view="x"]` (nav or rail) and panels `[data-view-panel="x"]`.
  Sets `aria-selected` and hides inactive panels. `[data-view-title]` takes the active trigger's text (`data-label`
  overrides it).
- **Selection**: `data-ax-select` with rows `[data-id]` and details `[data-detail="id"]`. Fires `ax:select` `{id}`.
  Combines with `data-ax-filter` on the same element.
- **Collapse panels**: `data-ax-toggle="#insp"` on a button toggles the panel's `data-collapsed` and its
  `aria-pressed`.
- **Responsive**: under 1180px the inspector starts collapsed and floats; under 900px secondary top-bar controls hide;
  under 760px the sidebar floats. Design for 1280px.

App rules: one `ax-topbar` per shell, the primary action (if any) in it. Rail for top-level sections (≤7), sidebar for
navigation inside a section. The inspector shows the selected item's properties, never main content.
`APX.surface` returns `"widget"` or `"app"`.

## Records

Records the owner adds (entries, contacts, items) live in the artifact's database, not in `APX.state`: state is for
what the owner chose (filters, the open view), up to 64,000 characters; the database holds up to 50 MB.

- Create the schema on start with `CREATE TABLE IF NOT EXISTS`, and keep a schema version in a one-row table so a later
  version can migrate it:

```js
async function ready() {
  if (!APX.db.available) return false; // a published page or a plain preview: show a note instead
  await APX.db.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)");
  await APX.db.exec(`CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY, title TEXT NOT NULL, amount REAL, done INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')))`);
  await APX.db.exec("INSERT OR IGNORE INTO meta (k, v) VALUES ('schema', '1')");
  return true;
}
const list = () => APX.db.query("SELECT * FROM entries ORDER BY created_at DESC LIMIT 200");
const add = (title, amount) => APX.db.exec("INSERT INTO entries (title, amount) VALUES (?, ?)", [title, amount]);
```

- Values always as `params` (`?`), never pasted into the SQL. Read with `query`, write with `exec`.
- Changing an existing app: never drop or rename a table or column it already has. Add columns with `ALTER TABLE …
  ADD COLUMN` behind a check of `meta.schema`, then bump it.
- Page long lists (`LIMIT`/`OFFSET`); a query returns at most 2,000 rows. A slow query is not stopped: index what you
  filter on.
- Where the database is not available (`APX.db.available` false), say so in an `ax-empty-app` and keep the rest of
  the app working.
- The owner can export the app with or without its data; an export to share never carries it.
