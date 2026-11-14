# Cards in an answer

Results the owner compares (movies, series, stays, flights, products, places, the steps of a routine) can show as
cards inside your answer, with no artifact. Write the block in your reply; the panel and the phone draw it with APX's
own cards. Always keep a complete text answer outside the block: channels (WhatsApp, Telegram…) show only the text.

Pick the view by what the owner has to do (`"view"`, default `cards`):

| The owner… | `view` |
|---|---|
| looks through results and picks (series, stays, products, recipes) | `cards` |
| decides one thing with a price (a product, a plan, a flight) | `choice` |
| compares 2–4 options on the same attributes (plans, laptops, hostings) | `compare` |
| finds places (cafés, hotels, stops) | `places` |
| books a day and time (a table, an appointment, a class) | `booking` |
| sees something done (booked, bought, scheduled) | `receipt` |
| follows a plan in time (a trip, an event, a week) | `agenda` |

Write the block at once, short: the owner sees it taking shape until it closes. Facts nobody confirmed are left out
or written "—", never invented. A button either opens an `https` page (`url`) or writes a message to this chat as
the owner (`ask`): choosing, booking or paying always comes back to you in the chat, and you confirm before doing it.

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
      "image": "https://…/poster.jpg",
      "badges": ["Drama", "108 min"],
      "fields": [{ "label": "Dónde", "value": "Netflix" }],
      "details": "Lo que se lee al abrir la tarjeta.",
      "action": { "label": "Ver en Netflix", "url": "https://…" }
    }
  ],
  "fallback": "La luna tranquila (2024), drama espacial."
}
```
````

- `title` and `fallback` (what a client that cannot draw it shows) — `fallback` is required.
- `layout`: `grid` (cards to slide through, a picture on top) or `list` (one under another, the picture beside).
- Per item, only `id` and `title` are required. `eyebrow`: a short label above the title (kind, year, date).
  `description`: one or two lines. `badges`: up to 8 short tags. `fields`: up to 8 label/value rows of short facts
  (price, times, rating); a sentence goes in `description` or `details`. `details`: longer text the owner opens.
- `image`: the picture's `https` address, taken from the page you read (the poster, the hotel photo, the product
  shot), at least 600 px wide when the page offers sizes, or a media id (`med_…`) of one in APX. Add one whenever
  the source shows it: cards read far better with it.
- `images`: up to 8 more pictures of the same result (rooms, views): the card shows the first with a "+N" that opens
  them all.
- `highlight`: the one figure the result is chosen by, large on the card: `{ "value": "ARS 168.577", "label":
  "Total · 2 noches" }` (a price, a rating, a length). Facts and `details` open in a dialog with "Ver detalles".
- `action`: one button: `{ "label", "url" }` opens the result's page ("Ver en Booking"), `{ "label", "ask" }`
  writes `ask` to the chat ("Elegir" → "Quiero ver Cadáveres"). Only pages you read or found; never a guessed address.
- An address that is not `https` makes the whole block show its fallback.
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

APX draws Text (`weight: "bold"` is a title, `variant: "caption"` small), Image (`url` a media id or `https` address; `variant` icon,
avatar or smallFeature is small), Row, Column, List (`direction: "horizontal"` is a grid), Card, Divider and Modal (an
expandable section; its `trigger` Text is the label). Values are literal: no data bindings, functions or Button
actions — a block that uses them, or any other component, shows its fallback. Every component must hang from `root`.

## The other views

All take `title`, `subtitle` (one line under it), `note` (a short pill on the right: "Precios de hoy 14:20"),
`fallback` and up to three `buttons` (`{ "label", "url" }` or `{ "label", "ask" }`). In `submit.ask`, `{option}`,
`{quantity}`, `{price}`, `{day}`, `{time}`, `{people}` and `{what}` are filled with what the owner chose; leave `ask`
out and APX writes a clear default that asks you to confirm before paying.

`choice` — one option with a price (2–8 options):

````
```apx-cards
{ "view": "choice", "title": "Auriculares inalámbricos", "subtitle": "Hasta $120.000 · con cancelación de ruido",
  "note": "Precios de hoy 14:20", "quantity": 5,
  "options": [
    { "id": "bruma", "title": "Bruma Lite", "badge": { "label": "Mejor precio", "tone": "success" },
      "description": "24 h de batería · llega mañana", "rating": "4,2 · 1.380 opiniones", "price": "$64.900",
      "image": "https://…" },
    { "id": "pulso", "title": "Pulso Pro", "badge": { "label": "Recomendado", "tone": "info" },
      "description": "36 h · llega el martes", "rating": "4,6", "price": "$98.500", "was": "$118.000" }
  ],
  "submit": { "label": "Seguir con esta", "ask": "Quiero {quantity} {option} ({price}). Confirmame antes de pagar." },
  "fallback": "Bruma Lite $64.900; Pulso Pro $98.500." }
```
````

`compare` — columns are the options (2–4), rows the attributes (up to 12, one value per column); `best` marks the
best cells of a row by column index, `recommended` the column that starts picked:

````
```apx-cards
{ "view": "compare", "title": "Hostings para Acme",
  "columns": [ { "title": "Sevalla", "subtitle": "el que usás hoy" },
               { "title": "VPS propio", "badge": { "label": "Recomendado", "tone": "info" } } ],
  "rows": [ { "label": "Costo al mes", "values": ["US$ 35", "US$ 12"], "best": [1] },
            { "label": "Mantenimiento", "values": ["Ninguno", "Tuyo"], "best": [0] } ],
  "recommended": 1, "submit": { "label": "Ir con {option}" },
  "fallback": "Sevalla US$ 35; VPS propio US$ 12." }
```
````

`places` — up to 8 places with real coordinates from the source (`lat`, `lng`); `origin` is where the owner is.
APX draws a schematic map, the list and "Cómo llegar":

````
```apx-cards
{ "view": "places", "title": "Cafés para trabajar", "origin": { "lat": -41.1335, "lng": -71.3103 },
  "places": [ { "id": "puerto", "title": "Café del Puerto", "meta": "Café · 350 m · enchufes y wifi",
                "rating": "4,7", "status": { "label": "Abierto", "tone": "success" },
                "lat": -41.1331, "lng": -71.3062, "url": "https://…" } ],
  "fallback": "Café del Puerto, a 350 m, abierto." }
```
````

`booking` — the place, `days` (up to 14) and `times` (up to 24); `"off": true` marks one that is not available;
`people` adds a counter:

````
```apx-cards
{ "view": "booking", "place": { "eyebrow": "Restaurante · Circuito Chico, km 18", "title": "Hostería del Bosque",
    "rating": "4,6", "meta": "Cocina patagónica · $$" },
  "days": [ { "label": "Hoy", "sub": "vie 14" }, { "label": "Lun", "sub": "cerrado", "off": true } ],
  "times": [ "20:00", { "label": "20:30", "off": true }, "21:00" ],
  "people": { "min": 1, "max": 8, "value": 2 }, "note": "Seña de $10.000 por persona",
  "submit": { "label": "Reservar" }, "fallback": "Hostería del Bosque: hoy 20:00 o 21:00." }
```
````

`receipt` — something that already happened; `status.tone` is `success`, `warning`, `info` or `neutral`:

````
```apx-cards
{ "view": "receipt", "title": "Mesa para 2 · Hostería del Bosque",
  "status": { "label": "Confirmada", "tone": "success" }, "when": "hace 1 min",
  "fields": [ { "label": "Cuándo", "value": "Hoy, viernes 14 · 21:00" }, { "label": "Seña", "value": "$20.000" } ],
  "code": { "label": "Código", "value": "HB-48213" }, "steps": { "done": 2, "total": 3 },
  "buttons": [ { "label": "Cancelar reserva", "ask": "Cancelá mi reserva en Hostería del Bosque" } ],
  "fallback": "Mesa para 2 confirmada hoy 21:00, código HB-48213." }
```
````

`agenda` — up to 7 days, each with up to 12 items in order; `done` marks what already happened:

````
```apx-cards
{ "view": "agenda", "title": "Tu finde en El Bolsón",
  "days": [ { "label": "Sáb 15", "items": [ { "time": "09:00", "title": "Salida desde Bariloche",
      "meta": "Ruta 40 · 2 h en auto", "done": true }, { "time": "20:30", "title": "Cena" } ] } ],
  "buttons": [ { "label": "Buscar dónde cenar", "ask": "Buscame dónde cenar el sábado en El Bolsón" } ],
  "fallback": "Sábado: salida 09:00, cena 20:30." }
```
````
