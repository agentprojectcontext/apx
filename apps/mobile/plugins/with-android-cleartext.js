// A core on the owner's network answers over plain HTTP (http://192.168.x.x:7440); Android release builds refuse
// that unless the app says so. iOS already allows local networking through Expo's default ATS settings.
const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withAndroidCleartext(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (!app) throw new Error("with-android-cleartext: no <application> in AndroidManifest.xml");
    app.$["android:usesCleartextTraffic"] = "true";
    return cfg;
  });
};
