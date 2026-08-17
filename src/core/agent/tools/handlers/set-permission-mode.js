// Changes the super-agent's own autonomy level. This is the gate that decides
// whether destructive tools run unattended, so the mode vocabulary must come
// from one place: it used to be spelled out three times in this file (a Set,
// the schema enum, and the error message), which meant adding or renaming a
// mode silently left two of them stale.
import { readConfig, writeConfig } from "#core/config/index.js";
import { PERMISSION_MODES } from "#core/constants/permissions.js";

const MODES = Object.values(PERMISSION_MODES);
const MODE_LIST = MODES.join(", ");

export default {
  name: "set_permission_mode",
  schema: {
    type: "function",
    function: {
      name: "set_permission_mode",
      description: `Set APX tool permission mode in ~/.apx/config.json. Modes: ${MODE_LIST}.`,
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: MODES },
        },
        required: ["mode"],
      },
    },
  },
  makeHandler: ({ requirePermission }) => async ({ mode, confirmed = false }) => {
    await requirePermission("set_permission_mode", { dangerous: true, confirmed, args: { mode } });
    if (!MODES.includes(mode)) throw new Error(`mode must be one of: ${MODE_LIST}`);
    const cfg = readConfig();
    cfg.super_agent = cfg.super_agent || {};
    cfg.super_agent.permission_mode = mode;
    writeConfig(cfg);
    return { ok: true, mode };
  },
};
