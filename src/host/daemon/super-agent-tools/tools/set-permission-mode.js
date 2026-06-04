import { readConfig, writeConfig } from "../../../../core/config.js";
import { confirmedProperty } from "../helpers.js";

const MODES = new Set(["total", "automatico", "permiso"]);

export default {
  name: "set_permission_mode",
  schema: {
    type: "function",
    function: {
      name: "set_permission_mode",
      description: "Set APX tool permission mode in ~/.apx/config.json. Modes: total, automatico, permiso.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["total", "automatico", "permiso"] },
          confirmed: confirmedProperty("true only after explicit user confirmation for this exact permission-mode change"),
        },
        required: ["mode"],
      },
    },
  },
  makeHandler: ({ requirePermission }) => ({ mode, confirmed = false }) => {
    requirePermission("set_permission_mode", { dangerous: true, confirmed });
    if (!MODES.has(mode)) throw new Error("mode must be total, automatico, or permiso");
    const cfg = readConfig();
    cfg.super_agent = cfg.super_agent || {};
    cfg.super_agent.permission_mode = mode;
    writeConfig(cfg);
    return { ok: true, mode };
  },
};
