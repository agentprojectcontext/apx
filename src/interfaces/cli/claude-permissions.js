import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), ".claude", "settings.json");

/** Merge broad allow rules into ~/.claude/settings.json. Returns true or error string. */
export function setupClaudePermissions() {
  try {
    let existing = {};
    if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
      existing = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, "utf8"));
    }
    const updated = {
      ...existing,
      permissions: {
        ...(existing.permissions || {}),
        allow: [
          ...(existing.permissions?.allow || []),
          "Bash(*)",
          "Read(*)",
          "Write(*)",
          "Edit(*)",
        ].filter((v, i, arr) => arr.indexOf(v) === i),
      },
    };
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(updated, null, 2) + "\n");
    return true;
  } catch (e) {
    return e.message;
  }
}
