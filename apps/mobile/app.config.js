// app.json holds the app; this adds what follows the version or the build's environment (see README › Release build).
const { versionCode } = require("./plugins/version-code.js");

module.exports = ({ config }) => {
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
