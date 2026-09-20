// GET /android/latest — what the published APK is, for the phone running it.
//
// There is no Play Store in front of this app, so nothing tells a phone it is
// out of date. This is what the app asks instead, and it asks the DAEMON and
// not GitHub: the daemon is the only thing the app ever talks to, it caches for
// every phone paired to it at once, and it is one place to later hold a build
// back if one ever has to be.
//
// `?installed=<versionName>` is answered rather than left to the caller: the
// comparison is semver, the caller is Java, and a second implementation of
// "is this newer" is a second set of rules about 0.10.0 vs 0.9.0.
import { isNewerVersion, publishedApk } from "#core/android-release.js";
import { asyncRoute } from "./shared.js";

export function register(api) {
  api.get("/android/latest", asyncRoute(async (req, res) => {
    // `force` is the owner pressing "check now" — the cached hour is exactly
    // wrong at the moment somebody is standing there wondering.
    const latest = await publishedApk({ force: req.query.force === "1" });
    if (!latest) {
      // Not 200-with-nulls: "I could not reach GitHub" must never be readable
      // as "you are up to date". The phone that most needs telling is the one
      // whose owner is not looking at it.
      return res.status(503).json({ error: "could not reach the release" });
    }
    const installed = typeof req.query.installed === "string" ? req.query.installed : null;
    res.json({
      ...latest,
      ...(installed
        ? { installed, update_available: isNewerVersion(installed, latest.version) }
        : {}),
    });
  }));
}
