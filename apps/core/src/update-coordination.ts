import fs from "node:fs";
import path from "node:path";
import {
  compareVersions,
  coreBundleName,
  desktopAssetFor,
  fetchReleases,
  newerReleases,
  type Params,
  type Platform,
  type Release,
  type Result,
  UpdateCoordination,
} from "@apx/protocol";
import { errorMessage } from "./errors.ts";
import type { UpdateResult } from "./updates.ts";

type Coordination = Result<"system.update_prepare">;

function writeIntent(file: string | undefined, next: Coordination): void {
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.next`;
  fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function readIntent(file: string | undefined, version: string): { state: Coordination | null; error?: string } {
  if (!file || !fs.existsSync(file)) return { state: null };
  try {
    if (fs.statSync(file).size > 16_384) throw new Error("Update state is too large");
    const state = UpdateCoordination.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (state.target === version) {
      const next = { target: state.target, running: version, phase: "complete" as const };
      writeIntent(file, next);
      return { state: next };
    }
    if (state.phase === "installing" || state.phase === "restarting" || state.phase === "complete") {
      const next = {
        ...state,
        running: version,
        phase: "failed" as const,
        error: "The core did not start the target release. Retry the update or inspect the service.",
      };
      writeIntent(file, next);
      return { state: next };
    }
    return { state: { ...state, running: version } };
  } catch {
    return {
      state: null,
      error: "The persisted update state cannot be read. Inspect the core update state before retrying.",
    };
  }
}

/** Durable intent survives the connection that requested it and the core's supervised restart. */
export function createUpdateCoordination(opts: {
  version: string;
  file?: string | undefined;
  supported: boolean;
  platform?: Platform | undefined;
  feed?: string | undefined;
  fetch: typeof fetch;
  now?: () => number;
  install(release: Release): Promise<UpdateResult>;
  restart?(): void;
}) {
  const now = opts.now ?? Date.now;
  const recovered = readIntent(opts.file, opts.version);
  const supported = opts.supported && !recovered.error;
  let state: Coordination | null = recovered.state;
  let selected: Release | undefined;
  let busy: Promise<UpdateResult> | undefined;
  let preparing: Promise<unknown> = Promise.resolve();

  function save(next: Coordination): Coordination {
    writeIntent(opts.file, next);
    state = next;
    return { ...next };
  }

  async function releaseAt(target: string): Promise<Release> {
    if (!opts.feed) throw new Error("This core has no release feed");
    const release = newerReleases(await fetchReleases(opts.feed, opts.fetch), "0.0.0").find(
      (r) => r.version === target,
    );
    if (!release) throw new Error(`APX ${target} is not a published stable release`);
    return release;
  }

  async function prepare(params: Params<"system.update_prepare">): Promise<Coordination> {
    if (!supported || !opts.file || !opts.platform)
      throw new Error("This core cannot coordinate a supervised bundle update");
    if (compareVersions(params.target, opts.version) < 0)
      throw new Error("A coordinated update cannot downgrade the running core");
    if (state && state.target !== params.target && (busy || state.phase === "prepared" || state.phase === "restarting"))
      throw new Error(`APX ${state.target} is already the shared update target`);
    const release = await releaseAt(params.target);
    const core = coreBundleName(params.target, opts.platform);
    const desktop = desktopAssetFor(
      release.assets,
      params.target,
      params.desktop,
      params.format === "zip" ? "zip" : "installer",
    );
    if (!release.assets.some((a) => a.name === core) || !release.assets.some((a) => a.name === `${core}.sha256`))
      throw new Error(`APX ${params.target} has no core bundle with a checksum for this server`);
    if (!desktop || !release.assets.some((a) => a.name === `${desktop.name}.sha256`))
      throw new Error(`APX ${params.target} has no Desktop package with a checksum for this client`);
    // Another client may already be installing this target while the asset check was in flight.
    selected = release;
    if (state?.target === params.target && state.phase !== "failed") return { ...state };
    return save({
      target: params.target,
      running: opts.version,
      phase: params.target === opts.version ? "complete" : "prepared",
    });
  }

  function apply(target: string): Promise<UpdateResult> {
    if (!state || state.target !== target || !supported)
      return Promise.resolve({
        ok: false,
        restart: false,
        log: "Prepare the shared target release before updating the core.",
      });
    if (busy) return busy;
    if (state.phase === "complete")
      return Promise.resolve({ ok: true, restart: false, log: "The core is running the target release.", target });
    if (state.phase === "restarting")
      return Promise.resolve({
        ok: true,
        restart: true,
        log: "Waiting for the core to start the target release.",
        target,
      });
    if (state.phase === "failed")
      return Promise.resolve({
        ok: false,
        restart: false,
        log: state.error ?? "Prepare the failed update again before retrying.",
        target,
      });
    save({ target, running: opts.version, phase: "installing", deadline: new Date(now() + 22 * 60_000).toISOString() });
    busy = (async () => {
      try {
        const release = selected?.version === target ? selected : await releaseAt(target);
        const result = await opts.install(release);
        save({
          target,
          running: opts.version,
          phase: result.ok ? "restarting" : "failed",
          ...(result.ok
            ? { deadline: new Date(now() + 5 * 60_000).toISOString() }
            : { error: result.log.slice(-2000) }),
        });
        if (result.ok) opts.restart?.();
        return { ...result, target };
      } catch (err) {
        const error = errorMessage(err, 2000);
        save({ target, running: opts.version, phase: "failed", error });
        return { ok: false, restart: false, log: error, target };
      } finally {
        busy = undefined;
      }
    })();
    return busy;
  }

  return {
    state: (): Result<"system.update_state"> => {
      if (state?.phase === "restarting" && state.deadline && now() >= Date.parse(state.deadline))
        save({
          target: state.target,
          running: opts.version,
          phase: "failed",
          error: "The core did not confirm the target release before the restart deadline.",
        });
      return {
        coordination_protocol: 1,
        running: opts.version,
        coordination: state ? { ...state } : null,
        supported,
        ...(recovered.error ? { error: recovered.error } : {}),
      };
    },
    prepare(params: Params<"system.update_prepare">) {
      const next = preparing.then(() => prepare(params));
      preparing = next.catch(() => {});
      return next;
    },
    apply,
  };
}
