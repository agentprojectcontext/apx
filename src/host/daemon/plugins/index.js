// Plugin registry. Each plugin exports a default object:
//
//   {
//     id,                      // unique identifier (e.g. "telegram")
//     init(ctx) → instance,    // called once on daemon boot. ctx provides:
//                              //   projects: ProjectManager
//                              //   config:   global cfg from ~/.apx/config.json
//                              //   log:      log function
//     // instance shape:
//     //   { start(), stop(), status() → object, routes?(app) }
//   }
//
// Plugins are discovered by static import here. Adding a new plugin = importing
// it and pushing into PLUGINS.
import telegramPlugin from "./telegram/index.js";
import desktopPlugin from "./desktop/index.js";

export const PLUGINS = [telegramPlugin, desktopPlugin];

export class PluginManager {
  constructor({ projects, config, log, registries }) {
    this.projects = projects;
    this.config = config;
    this.log = log;
    this.registries = registries;
    this.instances = new Map();
  }

  initAll() {
    for (const p of PLUGINS) {
      try {
        const inst = p.init({
          projects: this.projects,
          config: this.config,
          log: this.log,
          plugins: this,        // self-reference so plugins can call siblings
          registries: this.registries,
        });
        this.instances.set(p.id, inst);
        this.log(`plugin ${p.id} initialized`);
      } catch (e) {
        this.log(`plugin ${p.id} init failed: ${e.message}`);
      }
    }
  }

  startAll() {
    for (const [id, inst] of this.instances) {
      try {
        inst.start?.();
      } catch (e) {
        this.log(`plugin ${id} start failed: ${e.message}`);
      }
    }
  }

  stopAll() {
    for (const [, inst] of this.instances) {
      try {
        inst.stop?.();
      } catch {}
    }
  }

  get(id) {
    return this.instances.get(id);
  }

  status() {
    const out = {};
    for (const [id, inst] of this.instances) {
      try {
        out[id] = inst.status?.() || { running: !!inst };
      } catch (e) {
        out[id] = { error: e.message };
      }
    }
    return out;
  }

  installRoutes(app) {
    for (const [id, inst] of this.instances) {
      if (typeof inst.routes === "function") {
        try {
          inst.routes(app);
        } catch (e) {
          this.log(`plugin ${id} route install failed: ${e.message}`);
        }
      }
    }
  }
}
