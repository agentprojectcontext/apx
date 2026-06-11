import fs from "node:fs";
import {
  ENGINES,
  collectAllSessions,
  findSessionAcrossEngines,
} from "#interfaces/cli/commands/sessions.js";

// Your own work sessions. This is how you remember what you did — never tell
// the user to run `apx session ...`; call this and answer from the result.
//
// DEFAULT: returns only YOUR OWN (apx engine) sessions. That is the right
// answer for "tus sesiones", "las tuyas", "what did you do", "last session".
// To look at a specific other engine, pass engine:"claude" | "codex".
// To sweep every engine at once, pass all:true (use only when the user
// explicitly asks across all engines).

function toIso(ms) {
  if (!ms) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

export default {
  name: "search_sessions",
  schema: {
    type: "function",
    function: {
      name: "search_sessions",
      description:
        "List or search your past work sessions, newest first. By DEFAULT it returns only YOUR OWN (apx) sessions — that is the correct answer for 'what did you do', 'tus sesiones', 'las tuyas', 'last/previous session'. Pass engine:'claude'|'codex' to look at one other engine, or all:true to sweep every engine (only when the user explicitly asks across all engines). Pass `id` to read one session's transcript so you can summarize it.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "free text matched against session titles (and content when deep=true). Omit to list the most recent sessions.",
          },
          engine: {
            type: "string",
            description:
              "limit to one engine: apx, claude, or codex. Omitted = apx (your own sessions). Set this only when the user names a specific other engine.",
          },
          all: {
            type: "boolean",
            description:
              "search across EVERY engine (apx + claude + codex) instead of just your own. Use only when the user explicitly asks for all engines.",
          },
          id: {
            type: "string",
            description:
              "fetch a single session's transcript by id instead of listing",
          },
          deep: {
            type: "boolean",
            description:
              "also search inside session content, not just titles (slower)",
          },
          limit: {
            type: "integer",
            description: "max rows; default 15",
          },
        },
        required: [],
      },
    },
  },
  makeHandler: () => ({ query, engine, all = false, id, deep = false, limit = 15 } = {}) => {
    if (engine && !ENGINES[engine]) {
      throw new Error(
        `unknown engine "${engine}" — valid: ${Object.keys(ENGINES).join(", ")}`
      );
    }

    // Read one session's transcript so the model can summarize it.
    if (id) {
      let hits = findSessionAcrossEngines(id) || [];
      if (engine) hits = hits.filter((h) => h.engine === engine);
      if (!hits.length) {
        return { found: false, id, message: `no session found with id "${id}"` };
      }
      const hit = hits[0];
      const eng = ENGINES[hit.engine];
      let content = null;
      try {
        const r =
          eng && typeof eng.readSession === "function"
            ? eng.readSession(hit, { tailBytes: 16 * 1024 })
            : null;
        if (r && r.found) content = r.tail;
      } catch {}
      return {
        found: true,
        engine: hit.engine,
        id: hit.id,
        title: hit.title || null,
        when: toIso(hit.mtime),
        cwd: hit.cwd || null,
        content,
      };
    }

    // List / search recent sessions. Default to your own (apx) engine unless
    // the caller named another engine or asked to sweep all of them.
    const engineId = engine || (all ? null : "apx");
    const rows = collectAllSessions({}, { engineId });
    const needle = (query || "").trim().toLowerCase();
    let matches = rows;
    if (needle) {
      matches = rows.filter((r) => {
        if (String(r.title || "").toLowerCase().includes(needle)) return true;
        if (deep && r.path) {
          try {
            return fs.readFileSync(r.path, "utf8").toLowerCase().includes(needle);
          } catch {
            return false;
          }
        }
        return false;
      });
    }
    matches.sort((a, b) => b.mtime - a.mtime);
    return matches.slice(0, Math.min(limit || 15, 50)).map((r) => ({
      engine: r.engine,
      id: r.id,
      title: r.title || null,
      when: toIso(r.mtime),
      cwd: r.cwd || null,
    }));
  },
};
