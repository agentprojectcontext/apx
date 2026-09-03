# Android surface

The native Android project lives in `src/interfaces/android/`. It deliberately
wraps the daemon-owned `/mobile` route instead of copying the React interface.
Native code owns only capabilities a browser/PWA cannot provide reliably:

- a revocable Android pairing token stored in private app preferences;
- a `WebView` shell that bootstraps `/mobile` with that token;
- the user-enabled `TYPE_APPLICATION_OVERLAY` mascot;
- a foreground WebSocket listener that turns inbound APX events into mascot
  bubbles, the bundled message sound, and Android notifications.
- an opt-in `NotificationListenerService` that watches only Google Maps
  notification metadata, records navigation start/end locally, and posts one
  authenticated event to the paired daemon when a trip begins. The event may
  include Maps' destination plus the newest cached Android location only after
  explicit foreground location permission. Never upload route geometry,
  location history, or complete notification text.

Never turn raw Maps notification churn into agent messages. Require 45 seconds
of stability for a known destination and 10 minutes before an unknown-route
prompt. Persist send history across service/app restarts. Suppress the same
destination for 30 minutes and any different destination for at least 5
minutes; keep only the newest pending state during rapid cancel/restart tests.
- a text share target for explicit Google Maps trip-progress shares. Accept only
  recognized Google Maps URLs, reuse an active trip id when present, and send
  the shared destination/link plus the newest permitted location to the same
  authenticated mobility endpoint. Treat opaque live-progress links as unknown
  destination; never derive a place name from the token. Generic text shares
  must never trigger a mobility event.

The native options menu persists mascot visibility and message sound separately.
Message sound defaults on and uses `res/raw/apx_notification.mp3`; the system
notification itself stays silent so each event plays exactly once.
`MainActivity` exposes only `APXAndroid.openOptions()` to trusted `/mobile`.
The React header renders its ellipsis beside Preferences only when that bridge
exists, so Chrome and installed PWAs never show native-only controls.
The bridge also exposes notification permission status and opens Android's app
notification settings. `/mobile` must show this native state inside the APK,
never WebView's unsupported browser Notification API result.

Google Maps trip detection lives in `MapsNavigationListenerService`. The user
grants notification-listener access in Android settings; `MainActivity` reports
that access and the current local travel state in its native options. Match the
exact Maps package plus an ongoing navigation category or conservative guidance
terms. Debounce removals because Maps replaces its notification during a trip.
Preserve the last non-empty destination metadata and delay delivery briefly so
Maps can publish it. If Maps omits destination, send current location without
claiming a route and post an Android Auto messaging card whose voice reply can
confirm destination. `TravelStatusBanner` stays native, above `/mobile`, and
opens Maps when tapped. Keep its container below system-bar insets with visible
top spacing.

Trip starts post to `/api/mobility/events`. The daemon deduplicates `event_id`,
acknowledges before background work, and lets the super-agent inspect only tasks
and commitments. Because the user explicitly configured this trigger, dispatch
must not consume or wait for proactive-round interruption budgets. The daemon,
not an agent tool, sends exactly one resulting Telegram message. Treat all
endpoint fields as untrusted data and never claim route proximity without route
evidence.

Mobility route enrichment uses keyless OpenStreetMap services: Nominatim for
geocoding/place search and Valhalla with OSRM fallback for driving geometry.
Keep requests bounded and user-triggered, cap suggestions at three, and filter
places to 700 m from computed geometry. A completed route check with no match
must stay silent. Every suggested place includes a clickable Maps coordinate
link.

An APX-controlled Android Auto head unit may use the private semantic
navigation channel as an experimental destination source. Verified DHU traffic
uses `0x8003` for navigation state, `0x8006` for maneuver/road/destination, and
`0x8007` for distance/ETA. This capability belongs to the head unit or proxy,
never the ordinary Android app. Treat protocol fields as untrusted and
version-dependent, deduplicate repeated frames, fail closed when destination is
empty or broad, and never capture projection video or audio. Stock car head
units cannot be retrofitted by granting another Android permission.

Android Auto is the SECOND trip source and it shares the notification
listener with the Maps detector. Match the projection package's own session
notification and treat FLAG_FOREGROUND_SERVICE as persistent alongside
FLAG_ONGOING_EVENT — a real Galaxy A55 session posts NO_CLEAR |
FOREGROUND_SERVICE with no ongoing flag, and gating on the ongoing flag alone
detects nothing. Reject setup invitations and the developer head-unit-server
notice; an unrecognised ongoing notification from that package still counts, so
an untranslated locale does not blind the detector. Track both sources
independently: the trip ends only when both are down, and a Maps route that
finishes while the car stays connected keeps the same `trip_id`.

Live position runs in a foreground service typed `location`, started and
stopped by the trip itself. Never request ACCESS_BACKGROUND_LOCATION — the
ongoing notification is the permission model, and the service is what buys
while-in-use access off screen. Post one point plus accuracy to
`/api/mobility/positions`, never route geometry and never a history. Sample at
30 s / 150 m and floor uploads independently; a foreground-service start can be
refused from the background, so log the refusal instead of assuming tracking is
live.

Proximity alerts are keyed on (trip, errand) — NOT on the place. A drive
through one town matched fifteen shops to two tasks and sent eight Telegram
messages in ninety seconds; the nearest matching place is the answer to an
errand, and the rest are noise. Evaluate candidates without recording them, and
burn the one-shot only on the ones actually sent, so a card the per-sample cap
held back is not silently spent. Alerts survive a daemon restart because the
delivered set is persisted before the send.

THE PROXIMITY ALERT DOES NOT DEPEND ON TELEGRAM. It is pushed as its own
`mobility_alert` frame on the events socket (`core/events/bus.js` →
`events-ws.js`), carrying its whole payload rather than a "go re-fetch" signal:
a phone in a tunnel cannot ask, and the card has to become four buttons within
a second of driving past the place. Telegram is a copy sent after, and a
missing plugin costs the copy and never the alert — it used to be the other way
round, so an install with no Telegram alerted nobody on the surface that
matters most. Answers come back on `POST /api/mobility/alerts/:id/answer`, and
the meaning of each one lives in `core/mobility/answer.js` so a tap on the car,
on the phone and on Telegram land on the same branch.

FOUR ANSWERS ON THE NATIVE CARD: navigate, add_stop, next, skip. `navigate` and
`add_stop` record the same thing "voy" does — the driver did not promise to go,
they started going — so the end-of-trip follow-up asks about them. `next` moves
the errand to the following shop; `skip` ("No ahora") puts it away until the
next drive, which the one-shot in state.js already enforces because any answer
other than `next` counts as announced.

THE CAR CARD CANNOT BE A NOTIFICATION. Android Auto renders a MessagingStyle
notification with exactly two controls, reply and mark-as-read; a four-answer
card does not fit a shape built for chat. Verified on the A55 with a live DHU
session: the notification posts with `category=navigation actions=4` and
gearhead logs `GH.MsgNotifParser: No semantic reply action found` and discards
it. The four answers therefore live in a Car App Library service
(`ApxCarAppService` + `TripScreen` + `AlertScreen`, category
`androidx.car.app.category.POI`), which is also the chip in the Auto launcher;
`CarAlertStore` is the process-wide set both ends share. Nothing on that path
carries an emoji, because Assistant reads the card aloud — the daemon strips
them before the frame is built and the strings in `values/strings.xml` never
add any back.

A proximity card carries two Maps deep links and two answers. "I'll go" is a
promise recorded against the alert, never an action on the task; the task moves
only when the owner answers the end-of-trip follow-up. Ask that follow-up once,
in plain text — the driving is over — and only for alerts that were answered
yes.

While a trip is active a Telegram reply goes out twice: the voice note, then
the same words as a flagged transcript carrying the keyboard. Length is decided
by running the TURN in voice mode (`channelMeta.voice` + `mobility`), never by
truncating afterwards. TTS or ffmpeg failing costs the audio and never the
message, and a "mock" provider is silence, not speech — refuse it.

The trip banner opens the trip's errands, never Maps — Maps is where the trip
is read FROM. Its list comes from a read-only `GET /api/mobility/trip`: asking
must never fire a reminder or spend a one-shot, and it is capped, because a city
search matches dozens of shops. The count must not read zero before the daemon
has answered; the daemon's list fills asynchronously as positions arrive.

A trip can outlive the app — reinstall, force stop, an OEM power-manager freeze
— leaving the trip flag set with no location service running. Resume tracking on
listener rebind AND from the foreground activity: a foreground-service start is
only guaranteed to be allowed while an activity is visible, and some OEMs refuse
it outright from a notification listener. Starting a running service is a no-op,
so calling both is safe.

Trip state must survive a daemon restart. The in-memory map is authoritative for
a trip the process has seen, but it is empty after a restart and the persisted
mobility context is not — without that fallback every position for the rest of a
real drive is answered "trip-ended" while the phone keeps uploading. The place
cache expires on time as well as distance, or an errand added mid-drive stays
invisible until the car has travelled the retarget distance.

The Android start event and end event share `trip_id`. Before Telegram delivery,
daemon must confirm that trip remains active; closing Maps cancels in-flight
output. Mobility Telegram keyboards route postpone into the delivery queue and
persist same-day silence. Outbound mobility rows use `via: mobility_delivery`
plus a bounded `notify` headline so Android can create one APX card and sound
without streaming full message bodies over the events socket.

Mobility events update persistent secretary context; they do not imply an
outbound message. Inject current trip, last mobility question, and last button
response into later super-agent turns and routines. The mobility agent may
return `SILENT`, and the daemon must not replace silence with a generic
"I see you are driving" fallback. Record each delivered mobility question and
callback so Roby knows what it just asked and never behaves like a stateless
notification trigger.

Send a state-only mobility event as soon as Android detects navigation. Apply
settling and cooldown gates only to evaluation-capable events, never to Roby's
trip awareness.

The Android token is separate from Chrome/PWA storage. Never read, export, or
share another client's token. Pair through `/api/pair/confirm` with
`kind: "android"` and let the daemon mint a new credential.

The mascot uses the shared web blob catalog, exported into Android drawables and
`MascotBlobCatalog.java` by `scripts/export_android_mascot_assets.py`. It stores
the avatar received in WebSocket `hello`/`settings` frames and repaints without
restarting the service. Keep its movement and message filtering aligned with
`src/interfaces/desktop/mascot.js` and `main.js`: inbound messages only, and no
self-notification for desktop/voice input.

Idle costs nothing; a trip is what may cost battery. The app is a WebView
shell, and everything expensive in it has to be justified by something actually
happening. Three rules, each of which was once broken and each of which the
phone's battery screen noticed:

- The mascot overlay draws only while it is being dragged, hopping, or showing
  a message. At rest it holds its pose and wakes twice per blink cycle — a
  perpetual `postInvalidateDelayed(32)` is a full software redraw thirty times
  a second, over whatever the owner is really using, all day.
- The WebView is paused AND its timers stopped when the activity leaves the
  screen. `onPause()` alone only stops drawing; `/mobile` is a live React app
  with its own socket, and without `pauseTimers()` it keeps running behind the
  launcher.
- The daemon socket's reconnect ladder is capped at 15 s during a trip and at
  5 min outside one, and it does not climb at all with no active network —
  `registerDefaultNetworkCallback` wakes it instead. A phone away from the
  daemon cannot dial it; retrying every 15 s for a whole day is thousands of
  radio wakeups that cannot succeed. Opening a trip reconnects immediately
  rather than waiting out an idle backoff.

Battery-optimisation exemption is the owner's decision, offered from the native
menu and never taken automatically. Without it Android defers the trip's start
and end while the phone is in a pocket; with it APX may also run while idle.
Report the real state (`isIgnoringBatteryOptimizations`), open the direct
dialog while restricted and the system list once exempt — that is where the
exemption is taken back — and fall back to the app details page on OEM builds
that ship neither screen.

Running the DHU is three steps and each one has a way to fail silently. The
head unit server is SINGLE USE: it must be started from Android Auto's own
overflow menu ("Iniciar servidor unidad princ.") before every DHU session, and
a second `desktop-head-unit` against a spent server dies with "Failed to read
from transport". `adb forward tcp:5277` opens the port on the MAC whether or
not anything listens on the phone, so a successful `nc -z` proves nothing —
check `adb shell ps -A | grep gearhead:projection` instead. The DHU is also an
interactive console: backgrounded with no stdin it exits immediately after the
handshake, so hold it open (`sleep 600 | ./desktop-head-unit`). And a template
app that is not published needs "Fuentes desconocidas" ticked in Android Auto's
developer settings or the chip never appears, with nothing logged to say why.

Android Auto's settings are not reachable by intent on One UI — there is no
launcher activity, and `.frx.SetupActivity` is the connect-to-a-car flow, not
the settings. The path is Settings → Connected devices → Connection preferences
→ Android Auto → ⋮.

`node scripts/mobility-alert-e2e.mjs` drives a whole alert against the running
daemon — a located errand, a trip, a GPS position 600 m away — and asserts the
card, its address, the four emoji-free actions and the answer round trip. It
cleans up after itself. With a phone attached, `adb shell dumpsys notification
--noredact | grep -A3 apx_proximity` shows the other half.

To exercise the Android Auto path without a car, run the Desktop Head Unit
against the phone. It needs Android Auto developer settings enabled on the
device (tap Version ten times in Android Auto's own settings, then the overflow
menu → start head unit server), `adb forward tcp:5277 tcp:5277`, and the DHU
binary from the SDK's `extras/google/auto/`. A session makes Android Auto post
its "connected to the car" notification, which is the signal the detector reads;
`adb logcat -s APXTravel:V` shows the trip opening and closing. Note that the
head-unit-server notification is itself persistent and must NOT be read as a
session — see AndroidAutoDetector.DEVELOPER_TERMS. Android Auto also shows a
consent dialog covering vehicle data, contacts, location, microphone and SMS;
APX's detection does not depend on it, so leave that decision to the owner.

The notification socket has the same problem as the trip service, from the other
end: `MascotOverlayService` is what holds the connection to the daemon, and only
`MainActivity` used to start it — so a reboot or the app's own update left the
phone silent, looking perfectly healthy. `StartupReceiver` handles
`BOOT_COMPLETED` and `MY_PACKAGE_REPLACED`; both are system broadcasts, so it
must be `exported="true"`, it skips an unpaired phone, and it catches Android's
refusal rather than letting a denied foreground-service start take the boot down.

Verified on hardware, and the result is not the same on every phone:

- **Samsung A55** — both halves work. The service returns after `adb install`
  with nothing opened, and after a real reboot with zero `ActivityRecord`s.
- **Honor 400 (MagicOS)** — the update half does NOT fire, with the broadcast
  confirmed dispatched and the app not in stopped state. The OEM refuses the
  background start, and Honor encrypts app logcat (`(HKS)…(HKE)`), so the
  refusal cannot be read on the device. On that phone, open APX once after
  installing; its auto-start whitelist is the manual toggle to try.
  Re-measured 2026-09-02 on MagicOS 10.0.0.207 / Android 16: zero
  `ServiceRecord`s still a full minute after `adb install -r`, so this is the
  steady state and not a slow broadcast. `adb shell am start -n
  dev.agentprojectcontext.apx/.MainActivity` is enough to bring it back — it
  works with the screen off and the phone locked, so the "open it once" step
  does not need the owner to unlock anything.

Testing a reboot is easy to get wrong. `adb reboot` returns before the phone
goes down, so poll `adb devices` until the serial disappears and prove it with
`/proc/uptime` before vs after. Samsung restores the last task on unlock, so
send HOME and force-stop first or the app starts the service itself. And read
`createTime` against uptime plus the `ActivityRecord` count — a running service
alone says nothing about who started it.

Build and verify with the repository-local wrapper:

```bash
cd src/interfaces/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
./gradlew testDebugUnitTest assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Both exports are load-bearing on this machine and neither is discoverable from
the error: `./gradlew` alone dies with "Unable to locate a Java Runtime" (the
JDK is Homebrew's, not linked as the system `java`), and once that is fixed with
"SDK location not found" — `local.properties` is gitignored, `ANDROID_HOME` is
unset, and the only SDK carrying `platforms/android-35` and `build-tools/35.0.0`
is the Homebrew commandlinetools one. The SDK under `proyectos_varios/android-lab`
is NOT it: platform-tools and system images only, nothing that compiles.

With two phones plugged in, every `adb` needs a target — `export
ANDROID_SERIAL=<serial>` once beats `-s` on each call.

The daemon still follows the normal APX dev loop. Android-only code does not
require `apx restart`; any daemon or web change does.
