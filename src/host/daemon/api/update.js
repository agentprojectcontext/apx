// GET /update — is there a newer APX than the one running?
//
// The CLI has printed this after every command for a long time; the panel had
// no way to know. Both now read the SAME 24h cache in core/update-check.js, so
// they cannot disagree and the registry is asked once a day no matter how many
// surfaces are looking.
import { updateStatus } from "#core/update-check.js";

export function register(api, { version }) {
  api.get("/update", (_req, res) => {
    res.json(updateStatus(version));
  });
}
