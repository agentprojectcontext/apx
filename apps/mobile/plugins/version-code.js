// Android installs an update only over a lower versionCode: it follows the version (2.1.3 → 20103), so a release tag
// gives a higher one with no counter to bump. Minor and patch stay under 100 for that.
function versionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) throw new Error(`versionCode: "${version}" is not major.minor.patch`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (minor > 99 || patch > 99) throw new Error(`versionCode: minor and patch of "${version}" must be under 100`);
  return major * 10000 + minor * 100 + patch;
}

module.exports = { versionCode };
