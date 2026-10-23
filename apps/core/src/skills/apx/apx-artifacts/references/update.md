# Updating an older artifact

For a widget made before the kit or before artifacts had memory: injected `apx-*` classes, numbers fixed in the HTML,
an API key written in the page, or a refresh that only works by asking you. Update it when the owner asks for a
change or a new look; do not rewrite one that works just because it is old.

## Keep what the owner has

- **Same `name`.** Another name is another artifact: empty memory, a new link, the old one left behind.
- **Same state keys.** `read_widget` shows `<widget_state>`: every key there, and every `data-ax-persist` key in the
  HTML, stays with the same meaning and shape. If a shape must change, read the old key in code, write the new one,
  then `APX.state.remove` the old one.
- **Same store keys and tables**, if it already uses them. Add columns; never drop or rename.
- Pinned, app and published stay as they are: they are flags, not HTML. A published artifact cannot be changed by
  you: say so and offer a copy with another name.

## Move it to the kit (a redesign, not a script tag)

"Update it to the new kit" means the owner should see the new look. Adding the kit's `<script>` and one class to a
page that keeps its own `<style>` changes nothing on screen: that is not an update.

1. Read the whole page (`read_widget`) and list what it shows: header, numbers, charts, tables, controls, live status.
2. Write the page again on the kit, section by section, with the same data and logic:
   - header → `header.ax-hero` (eyebrow, `h1`, one line, actions on the right) or `ax-header`;
   - numbers → `ax-grid` of `ax-card ax-stat` (`--accent` on the 3–5 key ones), trends → `<ax-spark>`;
   - charts → `<ax-chart>`, `<ax-bars>`, `<ax-donut>`, `<ax-split>`; keep a hand-drawn SVG only when no kit element
     draws it (candlesticks, maps), and color it with `--apx-*` tones (a canvas reads them with
     `getComputedStyle(document.documentElement).getPropertyValue("--apx-brand")` each time it draws, never hex);
   - controls → `ax-seg`, `ax-select`, `ax-btn` (one `--primary`), status → `ax-live` / `ax-badge`;
   - tables → `table.ax-table`, lists → `ax-list`, methodology → `details.ax-details`.
3. Delete the page's own `<style>` except a few lines of one-off layout, and every hard-coded color, gradient and
   shadow. Keep the script's logic (fetching, sockets, math); change only how it renders.
4. A new look the owner asked for (gradients, "the new design") is `<meta name="apx-style" content="aurora">`.
5. A page with a socket or a timer that should keep running while out of sight gets `<meta name="apx-live"
   content="15m">`; every live page also uses `APX.live` so it opens on its last reading (below).
6. Show it with `show_widget`, same name, the whole page. `edit_widget` is for small fixes, never for a redesign.
7. Check before you say it is done, each point, and fix what fails:
   - no `<style>` block of more than ~20 lines, no hex colors;
   - every control the owner sets (refresh interval, filters, tabs, a chosen view) is remembered: `data-ax-persist`
     on it, or `APX.state` in code. Closed and opened again, it must come back as they left it;
   - data fetched from outside goes through `APX.live("reading", loader, …)`, so the page opens on its last reading
     instead of blank and refreshes behind it;
   - no credential in the HTML or its state (below).
   Tell the owner what changed on screen, not only that the kit was added.

## Credentials out of the page

An API key, token or password written in the HTML, in its state or in a URL is a leak waiting to happen (anyone the
page is shared with sees it).

1. Ask the owner to save it as the secret `artifact.<name>.<key>` (for example `artifact.weather.token`). Never ask
   them to paste it in the chat, and never copy it from the old HTML into a message.
2. Replace the call with `APX.fetch(url, {secret: {name: "token", in: "bearer"}})` (or `in: "header"`/`"query"`/
   `"form"` with `param`). The url's origin must be in the artifact's `connect`.
3. Remove the value from the HTML and, with `edit_widget({name, state: {key: null}})`, from its state.

## A last reading instead of a blank

A widget that fetches live data should paint the last reading at once and then refresh: wrap its loader in
`APX.live("reading", loader, {every, render})` and show `ax-live` with `data-state="stale"` until the fresh one
arrives ([kit.md](kit.md#store-cached-data)). A widget whose numbers you wrote in by hand stays a snapshot: say so in
its header, keep its `data-ax-ask` "Refresh" button.

## Widget or app

Leave a widget a widget. Offer to make it an app (`edit_widget({name, app: true})`, and the app skeleton from
[app.md](app.md)) only when it already behaves like one: several views, records the owner adds, used on its own
rather than inside a chat. Ask first; the change of kind keeps its memory.
