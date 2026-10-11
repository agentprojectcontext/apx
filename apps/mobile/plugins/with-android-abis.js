// A release APK carries only arm64-v8a (nearly every phone since 2019), a quarter of the size of all four.
// APX_ANDROID_ABIS (comma-separated) builds others: armeabi-v7a for an old phone, x86_64 for an emulator.
const { withGradleProperties } = require("expo/config-plugins");

const KNOWN = new Set(["armeabi-v7a", "arm64-v8a", "x86", "x86_64"]);

module.exports = function withAndroidAbis(config) {
  const abis = (process.env.APX_ANDROID_ABIS || "arm64-v8a")
    .split(",")
    .map((abi) => abi.trim())
    .filter(Boolean);
  const unknown = abis.filter((abi) => !KNOWN.has(abi));
  if (!abis.length || unknown.length)
    throw new Error(`APX_ANDROID_ABIS: unknown ABI ${unknown.join(", ") || "(none)"}`);
  return withGradleProperties(config, (cfg) => {
    const others = cfg.modResults.filter(
      (item) => !(item.type === "property" && item.key === "reactNativeArchitectures"),
    );
    cfg.modResults = [...others, { type: "property", key: "reactNativeArchitectures", value: abis.join(",") }];
    return cfg;
  });
};
