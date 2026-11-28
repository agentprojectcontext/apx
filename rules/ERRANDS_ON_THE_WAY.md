# Errands on the way (car mode)

> Engineering design for location-aware errands. Decision: [D-286](DECISIONS.md#d-286). Contract:
> `packages/protocol/src/car.ts`. Lessons carried from v1 (branch `v1`, `rules/android.md` there) are marked **v1**.

The owner's phone tells the core when they drive and where they are. The core finds a place for each open errand
near the way ("buy milk" → the supermarket 900 m ahead) and offers it on the car screen, the phone and the panel,
with answers: go, add as a stop, another place, later, not this trip, no more this trip, done. What the owner picks
is remembered per place, so the places they use come first next time.

It is part of APX, not an extension: it needs code in the APK (car detection, a location service, the Android Auto
screens) and tables and methods in the core, neither of which an extension can bring. It is **off by default**; until
the owner turns it on the phone runs nothing and the core does nothing. A core on a server works the same: the phone
reaches it with its paired key, the app does not need to be open.

## Privacy and compatibility

From 2.18.1, `phone.privacy` and owner-only `phone.configure_privacy` hold two installation-wide choices, separate from telemetry: requested location and trip location. Existing OS permissions and choices are retained; global errands and each phone's participation still start off. Disabling trip location also disables global errands. The core rejects disabled positions before ingestion, rechecks punctual consent after the node reply and never reopens a trip revoked by the owner. Revoked trip ids are tombstoned in settings; ordinary idle expiration remains recoverable.

The native service validates the current trip and privacy before registering location listeners, then validates every five seconds with an independent twelve-second main-handler deadline. A failed/late validation ends the service, removes listeners, clears local alerts and latches a persistent safety pause. Queued position sends check the local active trip again. Only a local explicit enable clears that latch. A persisted trip-consent revision also rejects an off/on that happened while the phone was offline or its process was stopped; a punctual-location change does not revoke this separate trip revision. No pre-trip last-known fix is reused. Two small validation calls per cycle trade extra requests for conservative shutdown; Android suspension can extend scheduling, so the usual seventeen-second detection window is not a hard real-time guarantee.

Both core and APK must be updated. The old APK has no remote GPS shutdown, although the updated core rejects its disabled positions. The updated APK fails closed for trip and punctual location against an old core without the privacy method. Pairing and camera remain independent. The usage-statistics control changes the existing shared `telemetry.set` consent and drops unsent usage counts; lifecycle reports retain their existing policy. See the English/Spanish privacy reference for user instructions and offline limits.

## Pieces

```
phone (APK)                                 core                                     owner
───────────                                 ────                                     ─────
ApxCarListener (notification listener)      car.trip_start ─┐                        Android Auto: APX car app
  Android Auto session / Maps route  ─────▶ car.position ───┼─▶ trips, matcher ─────▶ phone: heads-up with answers
TripLocationService (FGS, type location)    car.trip_end ───┘   providers (OSM,      panel: trip card (same answers)
  30 s / 150 m, posts over /rpc                                 Google), prefs       chat channel copy (optional)
ApxCarAppService (androidx.car.app)  ◀────── car.trip, car.answer, car.errand
MessagingStyle "APX" conversation    ◀────── offer text; voice reply → car.answer / threads.send to the super-agent
```

## Errands and their place

- An errand is a task with `kind: "errand"`. It gains `place` (`ErrandPlace`): `categories` (best first, from the
  closed `ErrandCategory` list), an optional `brand` ("La Anónima"), or a fixed `at` point (skips the search), and an
  optional `radius_m`.
- **Agents categorise when they create the errand.** The tasks tool's `place` argument lists the categories with
  examples; "papas fritas", "leche", "lavandina" are `supermarket`; "cuaderno", "fotocopias" are `stationery` (in
  Argentina a "librería" sells school supplies; a bookshop is `bookstore`); "pilas" are `supermarket`, `kiosk`,
  `electronics`. Ambiguous items get several categories, best first.
- **A fallback classifier** (`apps/core/src/car/categories.ts`, keywords in Spanish and English) fills categories
  for an errand without them (created in the panel, imported from v1), so no errand is invisible to the search. The
  agent's choice always wins over the keywords.
- The panel and the phone show the place on the errand form: category chips, a brand field, "a fixed place".

## Phones

Each paired phone turns errands on for itself (**Use this phone for errands**, on the phone); APX on the computer
holds the one switch for every phone (`car.configure`) and lists the phones taking part (`car.phones`, table
`car_phones`, one row per device that ever turned errands on or started a trip). From that list the owner turns a
phone off (`car.phone` with its `device_id`): the core ends its trip and refuses its trip starts and points, so the
phone switches itself off on its next point or when its car page reads `car.settings` (`this_phone: false`), as if
its switch had been tapped. Only the phone turns itself back on (`car.phone` without `device_id`), since turning on
starts sharing that phone's location. The super-agent may turn a phone off through `apx_settings`, never on.

## Trips

- A trip starts when the phone reports an Android Auto session or a Maps route (**v1**: the trip ends only when both
  are down; a route that ends while the car is connected keeps the trip). `car.trip_start` is idempotent per
  `trip_id` (a UUID made by the phone).
- `car.position` carries one point (lat, lon, accuracy, speed, heading, time) — never a track. The core keeps the
  last point on the trip row only. The answer carries the new offers, so the phone does not need a socket (**v1**: an
  offer must become buttons within a second; a phone in a tunnel cannot ask).
- A trip with no position for 20 minutes ends on its own (background check `car-trips`, D-171), so a phone that died
  mid-drive does not leave the owner "driving" forever. Trip state lives in the DB, so a core restart keeps it
  (**v1**: an in-memory trip answered "trip ended" for the rest of a real drive).

## The matcher (per position)

1. Skip when: car mode off, no active trip, trip silenced, accuracy worse than 300 m, or another offer went out less
   than 45 s ago.
2. Open errands = tasks with `kind = errand`, `state = open`, not proposed, not held for this trip.
3. For each errand, candidates: its fixed place, or the places of its categories near the point (see Providers),
   filtered by brand, without places the owner avoids or declined this trip, and without those known to be closed.
4. **Reach** follows the owner's setting and the speed: `near` 600 m, `normal` 1.5 km, `far` 4 km, stretched to
   90 s of driving at the current speed (capped at twice the base). Behind the car (more than 100° off the heading
   when moving faster than 4 m/s) counts only within 300 m.
5. **Score** (lower is better) = distance ahead in metres × (1.6 if behind-ish) − preference bonus (preferred:
   −600 m, accepted before: −150 m per acceptance, up to −600 m; declined: +300 m each) − open-now bonus (known
   open: −200 m; closes within the hour: +300 m) − rating bonus (Google, (rating − 4) × 200 m).
6. Send at most **one offer per position**, the best-scoring errand within reach. **One-shot per (trip, errand)**,
   not per place (**v1**: per-place keys sent eight messages in ninety seconds through one town). The one-shot burns
   only when the offer is actually sent (**v1**).
7. `next` removes that place for this trip and lets the same errand be offered again at the next candidate;
   `later` holds the errand 15 minutes or 3 km, whichever comes later; `skip` holds it for the trip; `silence`
   stops every offer for the trip; `done` closes the task; `navigate` / `add_stop` record "going" and lock the
   errand to that place for the trip.

## Providers

- `PlaceProvider.search({ lat, lon, radius_m }, categories) → CarPlace[]`.
- **OpenStreetMap (default, keyless)**: Overpass, one query per tile (geohash-6 cells covering the circle) for every category's tags at once, cached in the `car_places` table for 7 days (ODbL allows storing,
  with credit "© OpenStreetMap contributors" on screens that list places). Public instances in order with a 10 s
  deadline; at most one request in flight and one every 2 s. `opening_hours` is evaluated by `car/hours.ts` (the
  common subset; anything else stays unknown — no dependency); most shops in Argentina have no hours (~10%).
- **Public Overpass is slow** (a 1 km city area took 48 s on a busy night; cached, 1 ms). A search never blocks a
  position: the request path reads only the cache and the trip's plan, fetches run in the background (warming the
  area ahead of the car at trip start and as it moves), and an offer found when a fetch lands is stored and handed to
  the phone with its next position.
- **Google Places (New), optional**: the owner's key, saved as a secret (`secret://car-google-key`). Text Search
  with `includedType`, `openNow` off and the Pro field mask (`id, displayName, location, types,
  formattedAddress, currentOpeningHours.openNow, rating`), location bias around the point. Only the place id and
  the owner's own answers are stored; names and hours are fetched fresh and kept only in memory for the trip
  (Google's terms). The settings say the owner needs billing on their Google project and should cap the daily
  quota; one person's use fits the free monthly caps.
- Both fail closed: a provider error means no offer, never a guess.

## Preferred places

- `car_place_prefs`: one row per place key with `accepted`, `declined`, `done`, the owner's explicit `choice`
  (`prefer` / `avoid`), categories, name and point (for Google: the name the owner was shown is not stored; the row
  keeps the id and point for at most 30 days unless the owner pins it, then the name is fetched when listed).
- Answers update it: `navigate`/`add_stop` → accepted; `next` → declined; `done` after going → done.
- The panel lists them ("Lugares que usás") with prefer / avoid / forget. Agents read them through `apx_settings`
  so "the bakery I always go to" has an answer.

## Delivery

- **Car**: the APX car app (androidx.car.app, category POI) shows the trip: waiting offers first, then open errands
  with their best place, and a "Hablar con Roby" row. An offer opens a screen with its answers; `navigate` and
  `add_stop` hand Google Maps the link. While the car app is open an offer also shows as a car alert.
- **Car without opening the app**: Android Auto only shows *messaging* notifications, with reply and mark-as-read
  (**v1**: a four-button card was discarded, `No semantic reply action found`). So the offer also goes out as a
  message in an "APX" conversation; Android Auto reads it aloud and the owner answers by voice ("voy", "después",
  "otro", "no", "ya está", "no me avises más"); the phone maps the reply to an action, or sends anything else to
  the super-agent as a message. The same conversation is the "talk to Roby" path in the car.
- **Phone**: a heads-up notification with the main answers, on its own channel (silent but vibrating: **v1**, a
  channel with neither never pops up on One UI).
- **Panel**: a `car.updated` event; the panel shows the trip and its offers with the same answers.
- **Chat channel**: optional copy with buttons (`tell_in_chat`), through the home channel.
- The wording leads with the errand, then the place, then the distance; the spoken text has no emoji and spells
  units out ("a un kilómetro y medio") (**v1**).

## Driving context

- While a trip is active the super-agent's turn input says the owner is driving, so it answers briefly, and with
  `voice_while_driving` its channel replies carry a voice note.

## Android specifics

- Detection: a `NotificationListenerService` (special access the owner grants once) watches Android Auto's session
  notification (`com.google.android.projection.gearhead`, persistent by `FLAG_ONGOING_EVENT` **or**
  `FLAG_FOREGROUND_SERVICE` — **v1**: an A55 posts the latter only) and Google Maps' navigation notification.
  Unrecognised wording from Android Auto still counts (locale independence, **v1**).
- Location: a foreground service of type `location`, started by the trip and stopped with it; no
  `ACCESS_BACKGROUND_LOCATION` (the ongoing notification is the permission model, **v1**). A refused start from the
  background is logged and retried when the app is opened.
- The service and the car app call the core over HTTP `/rpc/<method>` with the phone's own key; the JS app hands
  the address and key to the native side when car mode is turned on and clears them when unpaired.
- Sideloaded builds: Android Auto shows a car app that is not from Play only with *Unknown sources* on in Android
  Auto's developer settings. The phone's car mode screen says how.
- Testing: the Desktop Head Unit (DHU) over `adb forward tcp:5277 tcp:5277`.

## Widget

Android Auto gives no dashboard card to a points-of-interest app: the home screen holds navigation, media and
calls, and a message-style notification is the only thing that floats over it. The phone app therefore has a plain
home-screen widget (`ApxCarWidget`, RemoteViews): the offer waiting for an answer with its place, distance, Go now
and Another place (the same answer path as the notification), or a line saying nothing is near. It is redrawn when
offers change or a trip starts or ends, never on a timer. Google announced in May 2026 that phone widgets reach
Android Auto during the year; this widget needs no change for that. A media session to borrow the media card was
ruled out: it would take the place of the owner's music and Play admits only audio apps as media.

## Out of scope (for now)

- iOS / CarPlay.
- Route-aware detours (Search Along Route, OSRM): the heading cone is the first version; the provider interface
  takes an optional route so it can be added without changing callers.
- Self-hosted OSM extracts.
