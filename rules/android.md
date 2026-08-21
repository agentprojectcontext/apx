# Android surface

The native Android project lives in `src/interfaces/android/`. It deliberately
wraps the daemon-owned `/mobile` route instead of copying the React interface.
Native code owns only capabilities a browser/PWA cannot provide reliably:

- a revocable Android pairing token stored in private app preferences;
- a `WebView` shell that bootstraps `/mobile` with that token;
- the user-enabled `TYPE_APPLICATION_OVERLAY` mascot;
- a foreground WebSocket listener that turns inbound APX events into mascot
  bubbles, the bundled message sound, and Android notifications.

The native options menu persists mascot visibility and message sound separately.
Message sound defaults on and uses `res/raw/apx_notification.mp3`; the system
notification itself stays silent so each event plays exactly once.
`MainActivity` exposes only `APXAndroid.openOptions()` to trusted `/mobile`.
The React header renders its ellipsis beside Preferences only when that bridge
exists, so Chrome and installed PWAs never show native-only controls.
The bridge also exposes notification permission status and opens Android's app
notification settings. `/mobile` must show this native state inside the APK,
never WebView's unsupported browser Notification API result.

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
