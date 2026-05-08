// ProjectManager: in-memory registry of open projects.
// Projects are identified by path; no SQLite — filesystem is the source of truth.
import fs from "node:fs";
import path from "node:path";
import { appendMessageToFs } from "../core/messages-store.js";
import { effectiveConfig } from "./project-config.js";
import { readAgents } from "../core/parser.js";

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
    fs.mkdirSync(path.join(abs, ".apc", "messages"), { recursive: true });

    const entry = {
      id: this._nextId++,
      path: abs,
      config: effectiveConfig(this.globalConfig, abs),
    };
    entry.logMessage = (payload) => appendMessageToFs({ projectRoot: abs, ...payload });
    this.byId.set(entry.id, entry);
    this.byPath.set(abs, entry);
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
