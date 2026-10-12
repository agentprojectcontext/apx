// app.json holds the app; this adds what follows the version or the build's environment (see README › Release build).
const { versionCode } = require("./plugins/version-code.js");

module.exports = ({ config: base }) => {
  // A local build can name its version (APX_VERSION=2.3.0) without editing app.json; CI writes app.json from the tag.
  const config = { ...base, version: process.env.APX_VERSION?.trim() || base.version };
  const build = versionCode(config.version);
  const projectId = process.env.APX_EAS_PROJECT_ID?.trim();
  const googleServices = process.env.APX_GOOGLE_SERVICES_FILE?.trim();
  return {
    ...config,
    ios: { ...config.ios, buildNumber: String(build) },
    android: {
      ...config.android,
      versionCode: build,
      ...(googleServices ? { googleServicesFile: googleServices } : {}),
    },
    extra: { ...config.extra, ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}) },
    plugins: [...(config.plugins ?? []), "./plugins/with-android-abis.js"],
  };
};
