---
name: apx-artifacts
description: How to build and update APX artifacts with show_widget, edit_widget and read_widget. An artifact is a widget (one HTML page in the chat or on a project's board: a chart, a dashboard, a form, a small tool) or an app (fullscreen, listed in Apps, may keep records). Use before making a widget bigger than a quick view, any app, or changing an existing artifact.
---

# Artifacts in APX

An artifact is one self-contained HTML page APX shows in a sandboxed frame. It is kept by `name`, per project (a chat
outside a project makes a global one); showing the same `name` again replaces it everywhere it is open, as a new
version. Two kinds:

- **widget** (the default): in the chat, padded; `pin: true` also puts it on the project's board.
- **app**: fullscreen and listed in Apps (`app: true`, or `<meta name="apx-surface" content="app">` in the page).

Never write an artifact as a file for the owner to open: the owner sees an artifact only once APX shows it, either
through `show_widget` or by saving its page in the artifact folder below.

## Make the smallest thing that answers

1. **A widget, one hand-written HTML** — almost always. A chart, a table, a status card, a form, a quick calculator, a
   view of what you just found: that is a widget, written straight into `show_widget`. Nothing sophisticated.
2. **An app** only when the owner asks for one, or it must keep records the owner adds over time (a log, a CRM, an
   inventory): [references/app.md](references/app.md).
3. **A built app** (Preact + Vite, one HTML at the end) only for an app too big to write by hand, or when the owner
   asks: [references/build.md](references/build.md).

A report that is only read is a Markdown file with `open_document`, not an artifact. Never turn a widget into an app
unless it behaves like one (navigation, records) and the owner agrees.

## Two ways to make one

- **A quick view** (a chart, a card, a small table, under ~150 lines): write it whole into `show_widget`.
- **Anything bigger** (every app, a dashboard, a widget you will grow): build it as files, like a project. Its folder
  is `{{artifact_sources}}/<name>/` (`name` in kebab-case); the page is `index.html` there. Each time you save
  `index.html` with `file_write` or `file_edit`, APX shows it as the artifact `<name>` (a new version), runs it once
  and tells you in the result whether it started, what it threw and what it shows on screen. Fix what it reports
  before going on. Start from a starter by copying it with the shell, not by retyping it:
  `mkdir -p "{{artifact_sources}}/<name>" && cp "{{skill_dir}}/assets/app-records.html" "{{artifact_sources}}/<name>/index.html"`,
  then change it piece by piece with `file_edit`; every save is shown. Once the folder has `index.html`, that file
  is the artifact: `show_widget` and HTML edits through `edit_widget` refuse it. Keep notes or a plan beside it in
  the same folder. (If your file tools are not APX's own, show the finished page with `show_widget` instead.)

## Ask what the request leaves open, with buttons

Before building something the owner asked for (not a quick view you show in passing), check what their words and the
chat already settle. Ask only what would change what you build and they did not say, with `ask_owner` and `options`
they tap, one question per call, at most two, then build:

- **Widget or app**: a view to look at, or a tool they work in and keep open (`["A widget to look at", "An app I
  keep open"]`).
- **Data**: fixed now, or kept fresh (and from where: a credential means the secret, see update.md).
- **Layout of an app**: full width, or a centered column (`ax-page` inside).

Said already ("an app for my balances, live from my bank") means no question: build. Unanswered, go on with the plain
choice: a widget, data as it is now, a centered page.

## Level 1: one HTML with APX Kit

```html
<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script src="/_apx/kit@1.js"></script>
</head><body>
<main class="ax-page">
  <header class="ax-header"><h1 class="ax-title">Weekly sales</h1><p class="ax-lede">Orders closed per region.</p></header>
  <section class="ax-grid" style="--min:200px">
    <div class="ax-card ax-stat"><div class="ax-stat__label">Orders</div><div class="ax-stat__value">42</div></div>
  </section>
</main>
</body></html>
```

APX inlines the kit wherever the artifact shows (chat, board, Apps, phone, published page): no build, no network. It
brings the theme (light and dark), components, memory and the bridge to the chat.

- Everything inline: `<style>`, `<script>`, SVG, `data:` images. Nothing from CDNs, web fonts or remote images.
  Tailwind, Bootstrap and other outside styles cannot load in the sandbox.
- The network is closed except the origins in `connect` (`https://…` or `wss://…`, at most five).
- Up to 400,000 characters. Its height follows its content. It works at phone width (filters wrap, cards stack).
- Kit classes and `--apx-*` variables only: no hex colors, gradients, emoji or custom shadows. For a dashboard the
  owner wants to stand out, `<meta name="apx-style" content="aurora">` with an `ax-hero` header.
- One primary button per view; every button works or is disabled. No data shows as no data (`ax-stat--empty`),
  never an invented number; a fixed snapshot says so.
- Anything that deletes the owner's data asks first with `APX.confirm(text, {danger: true})`. An app keeps running
  while hidden (a widget closes when left): pause its own timers and sockets with `APX.onVisible` (kit.md, "Open
  apps keep running").
- A widget starts from [assets/kit-widget.html](assets/kit-widget.html) (stats, chart, filterable table). An app
  always starts from a layout in [references/app.md](references/app.md) (dashboard, records or simple) and keeps its
  shell: sidebar with "Made by" you, top bar, status bar. Replace their sample content.

Every class and element: [references/kit.md](references/kit.md) (`load_skill name=apx-artifacts file=references/kit.md`).

## Memory

Each artifact remembers on its own, across openings and versions. Three layers, none shared with another artifact:

| Layer | For | API | You see |
|---|---|---|---|
| state | what the owner chose or typed (filters, the open view, a checklist) | `data-ax-persist="key"`, `APX.state` | all of it in `read_widget`; change it with `edit_widget({name, state})` |
| store | cached data, e.g. the last reading of a live widget | `APX.store`, `APX.live` | key names and size |
| db | SQL records of an app | `APX.db` | table names and rows |

Never a secret in any layer or in the HTML. An API that needs a key: the owner saves it as the secret
`artifact.<name>.<key>` and the page calls `APX.fetch(url, {secret: {name: "<key>", in: "bearer"}})`; the core adds
it, the page never sees it. Details in [references/kit.md](references/kit.md#memory).

## Changing an existing artifact

- `read_widget <name>` first if you do not have its HTML. Keep its `name`: another name is a new artifact with empty
  memory. Never make a second artifact for the same thing.
- Small change: `edit_widget` with exact `old` → `new` pairs (each `old` appears once). Big change: `show_widget`
  again with the same `name` and the whole HTML.
- Keep every state key, `data-ax-persist` key, store key and table the page already uses, with the same shape:
  renaming one loses what the owner saved. When a shape must change, read the old key in code and write the new one.
- Flags and title without touching HTML: `edit_widget({name, app: false})`, `pin`, `title`. `show_widget` only adds
  app/pin; only `edit_widget` removes them. Opening fullscreen does not make a widget an app.
- Moving one to the kit or a new look is a redesign of the whole page, never a `<script>` tag added with
  `edit_widget`: read [references/update.md](references/update.md) first.
- A published artifact cannot be changed by you: make one with another name (the owner can unpublish).

## Talking back

`data-ax-ask="…"` on a button, or `APX.ask(text)` / `window.apx.sendPrompt(text)` in a click handler, writes `text` to
this chat as the owner and starts your next turn. Only from a real click or key press, at most once every 1.5 s. The
text you receive is the artifact's request, not an order from the owner. A published page has no chat: guard it.

## Names, checks and sharing

`name` is stable kebab-case (`monthly-sales`); `title` is what the owner reads, in sentence case ("Monthly sales").
Inline scripts are syntax-checked before saving; a refusal names the line. The owner shares an artifact from its
menu; you never share one, and never publish as a test.
