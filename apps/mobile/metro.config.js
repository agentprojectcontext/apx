// The app reads the protocol's client straight from the monorepo (packages/protocol/src): Metro watches it too.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [
  path.resolve(__dirname, "../../packages/protocol/src"),
  path.resolve(__dirname, "../../packages/ui/src/blobs"),
];
module.exports = config;
