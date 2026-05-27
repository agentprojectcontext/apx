// ProjectManager: in-memory registry of open projects.
// Projects are identified by path; no SQLite — filesystem is the source of truth.
import fs from "node:fs";
import path from "node:path";
import { appendMessageToFs } from "../../core/messages-store.js";
import { effectiveConfig } from "./project-config.js";
import { readAgents } from "../../core/parser.js";
import { getOrCreateApxId } from "../../core/scaffold.js";
import {
  ensureProjectStorage,
  DEFAULT_PROJECT_ID,
  DEFAULT_PROJECT_STORE,
} from "../../core/config.js";

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
    const projectJson = path.join(abs, ".apc", "project.json");
    if (!fs.existsSync(projectJson)) {
      throw new Error(`not an APC project: ${abs}`);
    }
    // Ensure directories exist for projects initialized before they were added.
    fs.mkdirSync(path.join(abs, ".apc", "commands"), { recursive: true });

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
    const apcDir = path.join(DEFAULT_PROJECT_STORE, ".apc");
    fs.mkdirSync(path.join(apcDir, "agents"), { recursive: true });
    const projectJson = path.join(apcDir, "project.json");
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
      let name = path.basename(e.path);
      try {
        const meta = JSON.parse(
          fs.readFileSync(path.join(e.path, ".apc", "project.json"), "utf8")
        );
        if (meta.name) name = meta.name;
      } catch {}
      return { id: e.id, path: e.path, name, agents: readAgents(e.path).length };
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
    entry.config = effectiveConfig(this.globalConfig, entry.path);
    return { projectRoot: entry.path, agents: readAgents(entry.path).length };
  }
}
