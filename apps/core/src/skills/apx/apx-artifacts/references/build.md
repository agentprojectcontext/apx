# Building an app (level 2)

Only for an app too big to write by hand (many views, real state, a few thousand lines), or when the owner asks for
one built this way. A widget, and most apps, are one hand-written HTML: see [../SKILL.md](../SKILL.md).

The result is still **one HTML page**: Preact (small, React's API) built with Vite and `vite-plugin-singlefile`, which
inlines every script and style. APX shows it like any other artifact and inlines the kit.

## Where the source lives

Never in the owner's project: an artifact's source belongs to the artifact.

```bash
apx artifacts dir expenses --project <project-id>   # prints (and creates) <APX home>/artifact-sources/<project>/expenses
```

Without `--project` it is a global artifact (`artifact-sources/global/<name>`). Use the same `name` you will show it
with. You may write and run commands there; the artifact's memory (`artifacts/…`) is the core's, never yours to touch.

## Steps

1. Copy [../assets/preact-app/](../assets/preact-app/) into the source folder (`package.json`, `vite.config.js`,
   `index.html`, `src/main.jsx`; read each with `load_skill name=apx-artifacts file=assets/preact-app/<file>`). Set
   the `<title>`; keep `<script src="/_apx/kit@1.js"></script>` and, for an app,
   `<meta name="apx-surface" content="app">`.
2. Write the app in `src/`. Use the kit's classes on your elements (`class="ax-card"`, the app skeleton from
   [app.md](app.md)) and `window.APX` for memory (`APX.state`, `APX.store`, `APX.db`, `APX.fetch`). No UI library,
   no CSS framework, no web fonts: they make the page big and fight the kit's theme.
3. `npm install` once, then `npm run build`: the page is `dist/index.html`. Keep it well under 400,000 characters;
   a starter builds to about 17,000.
4. Show it:

```bash
apx artifacts push expenses dist/index.html --title "Expenses" --app --project <project-id>
```

   `push` replaces the artifact by name, as `show_widget` does: a new version, memory kept. Never `push` a file
   you did not just build.
5. Changing it later: edit `src/`, build, push again with the same name. Keep table names, columns and state keys
   (see [update.md](update.md)).

## Rules

- Everything still runs in the sandbox: no network but the artifact's `connect` origins, through `APX.fetch` when a
  credential is involved. `push --connect https://api.example.com,https://…` sets the origins (at most five); without
  it `push` keeps the ones the artifact has.
- The kit is not there in `vite dev` (it is APX's): check the result by pushing it and opening it in APX.
- The owner's records live in the artifact's database, never in the source folder: rebuilding never loses them.
