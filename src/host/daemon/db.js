// ProjectManager: in-memory registry of open projects.
// Projects are identified by path; no SQLite — filesystem is the source of truth.
import fs from "node:fs";
import path from "node:path";
import { appendMessageToFs } from "#core/stores/messages.js";
import { effectiveConfig } from "./project-config.js";
import { readAgents } from "#core/apc/parser.js";
import { apcProjectFile, apcAgentsDir, apcCommandsDir } from "#core/apc/paths.js";
import { getOrCreateApxId } from "#core/apc/scaffold.js";
import {
  projectPresence,
  findMovedProject,
  missingProjectAdvice,
} from "#core/apc/project-presence.js";
import {
  ensureProjectStorage,
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_STORE,
} from "#core/config/index.js";

export class ProjectManager {
  constructor(globalConfig = {}) {
    this.byId = new Map();   // id -> { id, path, config, logMessage }
    this.byPath = new Map(); // absolute path -> entry
    this._nextId = 1;
    this.globalConfig = globalConfig;
  }

  setGlobalConfig(cfg) {
    this.globalConfig = cfg;
    for (const entry of this.byId.values()) {
      entry.config = effectiveConfig(this.globalConfig, entry.path);
    }
  }

  register(projectPath) {
    const abs = path.resolve(projectPath);
    if (this.byPath.has(abs)) return this.byPath.get(abs);
    const projectJson = apcProjectFile(abs);
    if (!fs.existsSync(projectJson)) {
      throw new Error(`not an APC project: ${abs}`);
    }
    // Ensure directories exist for projects initialized before they were added.
    fs.mkdirSync(apcCommandsDir(abs), { recursive: true });

    // Resolve stable APX storage ID (read from .apc/project.json).
    const apxId = getOrCreateApxId(abs);
    // Don't create the physical storage folder yet.
    // Just resolve where it SHOULD be.
    const storagePath = path.join(path.dirname(DEFAULT_PROJECT_STORE), apxId || "null");

    const entry = {
      id: this._nextId++,
      path: abs,
      storagePath,
      apxId,
      config: effectiveConfig(this.globalConfig, abs),
    };

    // Lazy message logger: ensure directory exists ONLY when writing.
    entry.logMessage = (payload) => {
      if (entry.apxId) {
        ensureProjectStorage(entry.apxId);
      }
      return appendMessageToFs({ projectRoot: entry.storagePath, ...payload });
    };

    this.byId.set(entry.id, entry);
    this.byPath.set(abs, entry);
    return entry;
  }

  // Register the always-available default project (no local .apc/ required).
  // Called once at daemon startup. Uses id=0.
  // The default project lives entirely at ~/.apx/projects/default/ and mirrors
  // the APC structure so that parser functions can read agents/memory from it.
  registerDefault() {
    if (this.byId.has(0)) return this.byId.get(0);
    // Create a minimal APC-compatible structure inside the storage root so that
    // readAgents() and other parser functions work without a separate project dir.
    fs.mkdirSync(apcAgentsDir(DEFAULT_PROJECT_STORE), { recursive: true });
    const projectJson = apcProjectFile(DEFAULT_PROJECT_STORE);
    if (!fs.existsSync(projectJson)) {
      fs.writeFileSync(
        projectJson,
        JSON.stringify({ name: "default", apx_id: DEFAULT_PROJECT_ID, apx: "installed" }, null, 2) + "\n"
      );
    }
    // The default project uses its storagePath as both the APC root and the storage root.
    const entry = {
      id: 0,
      path: DEFAULT_PROJECT_STORE,
      storagePath: DEFAULT_PROJECT_STORE,
      apxId: DEFAULT_PROJECT_ID,
      config: effectiveConfig(this.globalConfig, DEFAULT_PROJECT_STORE),
    };
    entry.logMessage = (payload) => appendMessageToFs({ projectRoot: DEFAULT_PROJECT_STORE, ...payload });
    this.byId.set(0, entry);
    this.byPath.set(DEFAULT_PROJECT_STORE, entry);
    return entry;
  }

  get(id) {
    return this.byId.get(Number(id)) || null;
  }

  getByPath(p) {
    return this.byPath.get(path.resolve(p)) || null;
  }

  list() {
    return Array.from(this.byId.values()).map((e) => {
      // The basename is a FALLBACK, not the name: it only wins when
      // .apc/project.json cannot be read, which is exactly the case that used to
      // pass unreported. `presence` is what lets a caller tell "this project is
      // called like its folder" from "we could not read this project at all".
      const presence = projectPresence(e.path);
      let name = path.basename(e.path);
      // Tipología del proyecto: personal | company | app | software | other.
      // El field es opcional en .apc/project.json; default = "other". El
      // panel web lo usa para elegir ícono y agrupar; el daemon no le pone
      // semántica especial. "default" es reservado para el proyecto id=0.
      let kind = e.id === 0 ? "default" : "other";
      try {
        const meta = JSON.parse(
          fs.readFileSync(apcProjectFile(e.path), "utf8")
        );
        if (meta.name) name = meta.name;
        if (typeof meta.kind === "string" && meta.kind.trim()) {
          kind = meta.kind.trim();
        }
      } catch {}
      return {
        id: e.id,
        path: e.path,
        name,
        kind,
        agents: readAgents(e.path).length,
        // Where this project's runtime state lives. The CLI needs it to reach
        // per-routine memory and anything else stored outside the repo — it has
        // no other way to resolve it, and `apx routine memory` was silently
        // broken for want of these two fields.
        apx_id: e.apxId || null,
        storage_path: e.storagePath || null,
        // Absence, reported. The panel draws its warning off this and the CLI
        // marks the row; without it a project whose folder is gone renders as a
        // perfectly ordinary one that happens to have no agents.
        missing: presence.missing,
        missing_reason: presence.missing ? presence.reason : null,
      };
    });
  }

  unregister(id) {
    const entry = this.byId.get(Number(id));
    if (!entry) return false;
    this.byId.delete(entry.id);
    this.byPath.delete(entry.path);
    return true;
  }

  rebuild(id) {
    const entry = this.get(id);
    if (!entry) throw new Error(`unknown project id ${id}`);
    // A rebuild reads the project off disk, and every one of those reads answers
    // "nothing" rather than failing when the folder is gone. Reporting that as
    // `0 agents` with a zero exit code is the most expensive kind of success:
    // it is indistinguishable from a project that genuinely has no agents, so
    // the one command a user runs to fix things CONFIRMED the breakage instead.
    const presence = projectPresence(entry.path);
    if (presence.missing) {
      throw new Error(
        `cannot rebuild ${missingProjectAdvice(entry, presence, findMovedProject(entry.path, entry.apxId))}`
      );
    }
    entry.config = effectiveConfig(this.globalConfig, entry.path);
    return { projectRoot: entry.path, agents: readAgents(entry.path).length };
  }

  /**
   * Point an existing project at a new folder, keeping its id.
   *
   * The id is registration order and the storage hangs off the apx_id, so the
   * only way to do this before — `remove` then `add` — handed the project a NEW
   * id and detached every routine, task, chat and board hook that named the old
   * one. Editing the entry in place is what makes a moved folder a non-event.
   *
   * The apx_id guard is the point of the whole thing: relinking to a folder that
   * carries a DIFFERENT id is not a move, it is pointing this project at
   * somebody else's data, and the storage it would then read is not the storage
   * it has been writing. `force` is there for the genuine re-init case.
   */
  relink(id, newPath, { force = false } = {}) {
    const entry = this.get(id);
    if (!entry) throw new Error(`unknown project id ${id}`);
    const abs = path.resolve(String(newPath || ""));

    const presence = projectPresence(abs);
    if (presence.missing) throw new Error(`cannot relink to ${abs}: ${presence.reason}`);

    const taken = this.byPath.get(abs);
    if (taken && taken.id !== entry.id) {
      throw new Error(`${abs} is already registered as project #${taken.id}`);
    }

    const apxId = getOrCreateApxId(abs);
    if (!force && entry.apxId && apxId && String(apxId) !== String(entry.apxId)) {
      throw new Error(
        `${abs} is a different project (apx_id ${apxId}, not ${entry.apxId}). ` +
        `Relinking would leave #${entry.id} reading storage it never wrote. ` +
        `Register it on its own with \`apx project add\`, or pass --force if this folder really is #${entry.id} re-initialized.`
      );
    }

    const from = entry.path;
    this.byPath.delete(from);
    entry.path = abs;
    entry.apxId = apxId;
    entry.storagePath = path.join(path.dirname(DEFAULT_PROJECT_STORE), apxId || "null");
    entry.config = effectiveConfig(this.globalConfig, abs);
    this.byPath.set(abs, entry);
    // `logMessage` reads entry.apxId/entry.storagePath at call time, so it
    // follows the move without being rebuilt.
    return { id: entry.id, from, path: abs, agents: readAgents(abs).length };
  }

  /**
   * Where project `id` seems to have moved to, or null.
   * Split out so the API can offer a one-click relink without guessing twice.
   */
  findMoved(id) {
    const entry = this.get(id);
    if (!entry) return null;
    if (!projectPresence(entry.path).missing) return null;
    return findMovedProject(entry.path, entry.apxId);
  }
}
