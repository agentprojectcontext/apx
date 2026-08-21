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
Preserve the last non-empty destination metadata and delay Telegram briefly so
Maps can publish it. `TravelStatusBanner` stays native, above `/mobile`, and
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

The Android start event and end event share `trip_id`. Before Telegram delivery,
daemon must confirm that trip remains active; closing Maps cancels in-flight
output. Mobility Telegram keyboards route postpone into the delivery queue and
persist same-day silence. Outbound mobility rows use `via: mobility_delivery`
plus a bounded `notify` headline so Android can create one APX card and sound
without streaming full message bodies over the events socket.

The Android token is separate from Chrome/PWA storage. Never read, export, or
share another client's token. Pair through `/api/pair/confirm` with
`kind: "android"` and let the daemon mint a new credential.

The mascot reuses the `noche` body PNG and eye geometry from the Electron
mascot. Keep its movement and message filtering aligned with
`src/interfaces/desktop/mascot.js` and `main.js`: inbound messages only, and no
self-notification for desktop/voice input.

Build and verify with the repository-local wrapper:

```bash
cd src/interfaces/android
./gradlew testDebugUnitTest assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

The daemon still follows the normal APX dev loop. Android-only code does not
require `apx restart`; any daemon or web change does.
