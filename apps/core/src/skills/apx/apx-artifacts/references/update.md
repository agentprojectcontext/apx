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

## Move it to the kit

1. Add `<script src="/_apx/kit@1.js"></script>` and swap the old classes for the kit's (`apx-card` → `ax-card`,
   `apx-stat` → `ax-stat__value` inside `ax-stat`, `apx-badge` → `ax-badge`, `apx-toolbar` → `ax-toolbar`). Drop the
   page's own colors and CSS the kit now covers.
2. Hand-written filters become `data-ax-filter` (see [kit.md](kit.md#filters-without-javascript)) with
   `data-ax-persist` on the fields, so they are remembered.
3. Show it again with `show_widget` and the same name (a whole new page), or `edit_widget` for a small change.

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
