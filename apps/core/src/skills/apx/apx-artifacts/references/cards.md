# Cards in an answer

Results the owner compares (movies, series, stays, flights, products, places, the steps of a routine) can show as
cards inside your answer, with no artifact. Write the block in your reply; the panel and the phone draw it with APX's
own cards. Always keep a complete text answer outside the block: channels (WhatsApp, Telegram…) show only the text.

## ```apx-cards — a list of results

````
```apx-cards
{
  "title": "Ideas de películas",
  "layout": "grid",
  "items": [
    {
      "id": "moon",
      "eyebrow": "Película · 2024",
      "title": "La luna tranquila",
      "description": "Drama espacial.",
      "image": "med_…",
      "badges": ["Drama", "108 min"],
      "fields": [{ "label": "Dónde", "value": "Netflix" }],
      "details": "Lo que se lee al abrir la tarjeta."
    }
  ],
  "fallback": "La luna tranquila (2024), drama espacial."
}
```
````

- `title` and `fallback` (what a client that cannot draw it shows) — `fallback` is required.
- `layout`: `grid` (cards side by side, a picture on top) or `list` (one under another, the picture beside).
- Per item, only `id` and `title` are required. `eyebrow`: a short label above the title (kind, year, date).
  `description`: one or two lines. `badges`: up to 8 short tags. `fields`: up to 8 label/value rows (price, times,
  rating). `details`: longer text the owner opens.
- `image` is a picture already in APX: its media id (`med_…`), from a picture you generated, one the owner sent, or
  one you attached. A web address is not drawn: the whole block shows its fallback.
- Up to 12 items. `"example": true` marks invented or sample data.
- Never claim availability, prices or times no source confirmed.

## ```a2ui — your own composition

For a layout the list does not fit, write A2UI v1.0 with its basic catalog; APX draws it with the same cards:

````
```a2ui
{
  "fallback": "Rutina: calentar diez minutos, luego veinte putts.",
  "messages": [
    { "version": "1.0", "createSurface": { "surfaceId": "golf",
      "catalogId": "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json" } },
    { "version": "1.0", "updateComponents": { "surfaceId": "golf", "components": [
      { "id": "root", "component": "List", "direction": "horizontal", "children": ["c1"] },
      { "id": "c1", "component": "Card", "child": "k1" },
      { "id": "k1", "component": "Column", "children": ["t1", "b1"] },
      { "id": "t1", "component": "Text", "text": "Calentar", "weight": "bold" },
      { "id": "b1", "component": "Text", "text": "Diez minutos de swings suaves." }
    ] } }
  ]
}
```
````

APX draws Text (`weight: "bold"` is a title, `variant: "caption"` small), Image (`url` a media id; `variant` icon,
avatar or smallFeature is small), Row, Column, List (`direction: "horizontal"` is a grid), Card, Divider and Modal (an
expandable section; its `trigger` Text is the label). Values are literal: no data bindings, functions or Button
actions — a block that uses them, or any other component, shows its fallback. Every component must hang from `root`.
