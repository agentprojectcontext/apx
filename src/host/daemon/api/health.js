// GET /health — unauthenticated; everything else requires the bearer token.
import crypto from "node:crypto";
import { APX_HOME } from "#core/config/paths.js";

/**
 * WHICH home this daemon serves, as a fingerprint rather than a path.
 *
 * A daemon serves one ~/.apx, and health is the only thing it says without a
 * token — so it must be able to answer "are you me?" for a second daemon about
 * to bind the same port, without publishing a filesystem path to anyone who can
 * reach the port. A truncated digest answers exactly that question and nothing
 * else: two daemons can compare, a stranger learns nothing.
 *
 * This exists because two daemons CAN hold one port without either one failing:
 * a wildcard bind (`*:7430`) and a loopback bind (`127.0.0.1:7430`) coexist, and
 * the specific one silently wins every local connection. No EADDRINUSE, no log,
 * no error — the real daemon just stops receiving. See daemon/index.js.
 */
export function homeId(home = APX_HOME) {
  return crypto.createHash("sha256").update(String(home)).digest("hex").slice(0, 16);
}

export function register(api, { version, startedAt }) {
  api.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      version,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
      home_id: homeId(),
    });
  });
}
