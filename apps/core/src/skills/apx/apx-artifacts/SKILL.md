---
name: apx-widgets
description: How to build APX widgets with show_widget, edit_widget and read_widget, the interactive HTML the owner sees in the chat, on a project's board or as a fullscreen app (charts, dashboards, forms, small tools, pages to share). Use before creating or restyling a widget, dashboard, form or fullscreen APX app.
---

# Widgets in APX

A widget is one self-contained HTML page APX shows in a sandboxed frame: in the chat, pinned to the project's board
(`pin: true`) or declared as an app (`app: true`, also listed in Apps). Without `app: true`, it is a widget. It is kept by name, per project (a chat outside a project
makes a global one). Showing the same `name` again replaces it everywhere it is open, as a new version.

Never write a widget, a page or an "artifact" as an HTML file on disk: the owner only sees what `show_widget` shows.

## The page

- Everything inline: `<style>`, `<script>`, SVG, images as `data:` URLs. **Nothing loads from outside**: no CDN
  scripts or stylesheets, no web fonts, no remote images. Write plain JavaScript and inline SVG for charts.
- The network is closed except the origins in `connect` (`https://…` or `wss://…`, at most five), and only for
  `fetch` or `WebSocket` to get live data. A widget that connects asks the owner first while outside content is in
  play.
- Up to 400,000 characters. Its height follows its content.
- Theme: the kit follows light and dark mode. Custom CSS uses the `--apx-*` variables (`--apx-bg`,
  `--apx-surface`, `--apx-fg`, `--apx-fg-muted`, `--apx-border`, `--apx-brand`), never hard-coded colors.
- Make it work at phone width: fluid widths, no horizontal scroll.

## APX Kit (use it for every new widget or app)

Put `<script src="/_apx/kit@1.js"></script>` in the page and build with its `ax-*` classes and `<ax-*>` elements.
APX inlines the kit wherever the widget shows (chat, board, Apps, phone, published page): no build, no network,
nothing to install. Tailwind, Bootstrap and other outside styles cannot load in the sandbox.

1. Read [references/kit.md](references/kit.md) (`load_skill name=apx-widgets file=references/kit.md`): classes,
   elements, filters, views, app skeleton and memory.
2. Start from a starter and replace its sample content:
   - [assets/kit-widget.html](assets/kit-widget.html): a widget for the chat (stats, chart, filterable table).
   - [assets/kit-app.html](assets/kit-app.html): a full app (rail, views, a list it remembers, settings).
3. A full app declares itself with `<meta name="apx-surface" content="app">`; APX then lists it in Apps.

**Memory.** A widget remembers between openings and versions: `data-ax-persist="key"` on fields and on views, tabs or
segments, or `APX.state.get/set/patch/on` in code. Keep in state what the owner entered or chose (tasks, notes,
filters, the open view), never sample data or secrets. Redraw from state in `APX.state.on`, so changes made by you or
another open copy show at once. You read it in `read_widget` and change it with `edit_widget({name, state})`.

Older widgets use the injected `apx-*` classes ([assets/starter.html](assets/starter.html)); they keep working, but
new ones use the kit.

- The saved type controls layout, never the view or window size: widgets get a 16–24px safe inset even when
  maximized; `app: true` declares an app with zero host padding and no kit width cap in every view. Public pages
  and mobile follow the same saved flag. Opening a widget fullscreen does not convert it into an app.
  Do not compensate with negative margins. Apps own their internal layout: add spacing around reading areas and
  controls when useful, while maps, canvases and navigation can reach the edges. Declare an app only when that
  behavior is intended; adding/removing it from Apps changes its saved app flag.
- Use one clear title + short description, then a separate filter row and the content. One primary action per view.
- Reuse the existing `--apx-*` colors and system fonts. Cards, subtle borders and green accents match APX;
  avoid ornamental gradients, nested cards and decorative shadows unless the owner asks for that style.
- Use real labels, semantic headings, native controls and visible focus. Status needs words, not color alone.
- At 360px width, filters wrap and cards stack. Only a wide table may scroll horizontally, inside its wrapper.
- Keep empty/no-results and disabled states readable. A filter must actually filter; a button must work or be
  explicitly disabled. Never imply live data when the widget contains a fixed snapshot.
- Verify the widget in its intended placement and both themes. A published page has no chat bridge and no saved
  memory (`APX.state.persistent` is false); guard `window.apx?.sendPrompt` and disable chat actions there. Never
  publish as a testing shortcut.

## Talking back

`data-ax-ask="…"` on a button (kit) or `window.apx.sendPrompt(text)` writes `text` to this chat as the owner, which
starts your next turn. It works only from
a click or key press (a real user gesture), at most once every 1.5 s. Use it for buttons such as "Refresh" or "Apply
this filter"; the text you receive is the widget's request, not an order from the owner.

## Changing one

- Convert type without reading or replacing HTML: `edit_widget({name:"monthly-sales", app:false})` makes a widget;
  `app:true` makes an app. `pin:false` unpins, `pin:true` pins. Omit flags to keep them. Flags alone keep the HTML,
  version, identity and public link, including for published surfaces. Never rebuild HTML just to change type.
- `show_widget` only adds app/pin placement; its false values do not remove it. Use `edit_widget` for removal.
- A title can change through `edit_widget({name:"monthly-sales", title:"Sales overview"})`, without resending HTML.
- Small content change: `edit_widget` with exact `old` → `new` pairs (each `old` must appear once). Get the current HTML with
  `read_widget <name>` first if you do not have it.
- Big change: `show_widget` again with the same `name` and the whole new HTML.
- `read_widget` without a name lists the project's widgets. Never make a second widget for the same thing.

## Names and titles

`name` is stable kebab-case (`monthly-sales`); `title` is what the owner reads ("Monthly sales"). Data a widget shows
is fixed at the moment you made it unless it fetches through `connect` or the owner asks you to refresh it.

Inline scripts are syntax-checked (never run) before the widget is saved; a refusal names the line, so fix it and call again.

## Sharing

A widget can be shared as a public page by the owner from the widget's menu; you never share one yourself. For a
report or a table that is only read, a Markdown document with `open_document` is usually better than a widget.
