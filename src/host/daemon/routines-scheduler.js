// Polling timer that fires due routines. Process-state — needs the daemon
// alive, has no business being in core/. Delegates the actual work to
// core/routines/runner.js so CLI / HTTP / web / mcp-server / scripts can
// invoke the same runner without depending on this file.
import { getDueRoutines } from "#core/stores/routines.js";
import { runRoutineNow } from "#core/routines/runner.js";
import { nowIso } from "#core/util/time.js";

const TICK_MS = 5_000;

export class RoutineScheduler {
  constructor({ projects, plugins, registries, globalConfig, log }) {
    this.projects = projects;
    this.plugins = plugins;
    this.registries = registries;
    this.globalConfig = globalConfig;
    this.log = log || (() => {});
    this._timer = null;
    this._running = false;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(
      () => this._tick().catch((e) => this.log(`routines tick error: ${e.message}`)),
      TICK_MS
    );
    this._timer.unref?.();
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _tick() {
    if (this._running) return;
    this._running = true;
    try {
      const nowStr = nowIso();
      for (const proj of this.projects.list().map((p) => this.projects.get(p.id))) {
        if (!proj) continue;
        const due = getDueRoutines(proj.storagePath, nowStr);
        for (const r of due) {
          this.log(`routine ${r.name} (${r.kind}) firing in project #${proj.id}`);
          await runRoutineNow(
            {
              project: proj,
              projects: this.projects,
              plugins: this.plugins,
              registries: this.registries,
              globalConfig: this.globalConfig,
            },
            r
          );
        }
      }
    } finally {
      this._running = false;
    }
  }
}
