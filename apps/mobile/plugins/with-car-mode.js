// Car mode (rules/ERRANDS_ON_THE_WAY.md): the native side lives in modules/apx-car; this declares its pieces in the
// app's manifest. Nothing runs until the owner turns car mode on in the app.
const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

const PKG = "dev.apx.car";
const PERMISSIONS = [
  "android.permission.FOREGROUND_SERVICE",
  // The trip's location service: while-in-use location off screen, without ACCESS_BACKGROUND_LOCATION.
  "android.permission.FOREGROUND_SERVICE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  // The car app's screens with a map of the errands' places (PlaceListMapTemplate).
  "androidx.car.app.MAP_TEMPLATES",
];

/** Replaces an element of `list` with the same android:name, or adds it. */
function put(list, element) {
  const name = element.$["android:name"];
  const rest = list.filter((item) => item.$?.["android:name"] !== name);
  return [...rest, element];
}

function withCarMode(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error("with-car-mode: no <application> in AndroidManifest.xml");

    app["meta-data"] = put(
      put(app["meta-data"] ?? [], {
        $: { "android:name": "com.google.android.gms.car.application", "android:resource": "@xml/automotive_app_desc" },
      }),
      // Car API 1 is enough for every screen; car alerts check the host's level themselves.
      { $: { "android:name": "androidx.car.app.minCarApiLevel", "android:value": "1" } },
    );

    let services = app.service ?? [];
    services = put(services, {
      $: {
        "android:name": `${PKG}.ApxCarListener`,
        "android:label": "@string/apx_car_listener_label",
        "android:exported": "false",
        "android:permission": "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
      },
      "intent-filter": [
        { action: [{ $: { "android:name": "android.service.notification.NotificationListenerService" } }] },
      ],
    });
    services = put(services, {
      $: {
        "android:name": `${PKG}.TripLocationService`,
        "android:exported": "false",
        "android:foregroundServiceType": "location",
      },
    });
    // Exported: Android Auto (the host) binds it; its HostValidator decides which hosts may.
    services = put(services, {
      $: { "android:name": `${PKG}.auto.ApxCarAppService`, "android:exported": "true" },
      "intent-filter": [
        {
          action: [{ $: { "android:name": "androidx.car.app.CarAppService" } }],
          category: [{ $: { "android:name": "androidx.car.app.category.POI" } }],
        },
      ],
    });
    app.service = services;

    // Not exported: only APX's own notifications fire it, so no other app can answer for the owner.
    app.receiver = put(app.receiver ?? [], {
      $: { "android:name": `${PKG}.CarActionReceiver`, "android:exported": "false" },
    });
    // The home-screen widget; exported because the launcher (and Android Auto, once it shows phone widgets) binds it.
    app.receiver = put(app.receiver, {
      $: {
        "android:name": `${PKG}.ApxCarWidget`,
        "android:exported": "true",
        "android:label": "@string/apx_car_screen_title",
      },
      "intent-filter": [{ action: [{ $: { "android:name": "android.appwidget.action.APPWIDGET_UPDATE" } }] }],
      "meta-data": [
        { $: { "android:name": "android.appwidget.provider", "android:resource": "@xml/apx_car_widget_info" } },
      ],
    });
    app.activity = put(app.activity ?? [], {
      $: {
        "android:name": `${PKG}.CarAnswerActivity`,
        "android:exported": "false",
        "android:excludeFromRecents": "true",
        "android:noHistory": "true",
        "android:taskAffinity": "",
        "android:theme": "@android:style/Theme.Translucent.NoTitleBar",
      },
    });
    return cfg;
  });
}

module.exports = withCarMode;
