// GET /engines — lists every engine adapter id known to core/engines.
import { ENGINE_IDS } from "../../../core/engines/index.js";

export function register(app) {
  app.get("/engines", (_req, res) => res.json({ engines: ENGINE_IDS }));
}
