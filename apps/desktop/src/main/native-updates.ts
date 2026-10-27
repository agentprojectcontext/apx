import fs from "node:fs";
import path from "node:path";
import { ApxClient, PROTOCOL_VERSION } from "@apx/protocol/client";
import { app, type BaseWindow, dialog, safeStorage } from "electron";
import { createUpdateCoordinator, type PendingUpdate } from "./update-coordinator.ts";
import { updateCredentials } from "./update-credentials.ts";
import type { createDesktopUpdater } from "./updater.ts";

export type NativeUpdateConnection = { identity: string; url: string; local: boolean; token?: string };

function updateRecovery(
  window: BaseWindow,
  actions: { retry(): Promise<void>; change(): Promise<void>; stopped(): boolean },
) {
  const es = app.getLocale().startsWith("es");
  let lastError: string | undefined;
  return {
    clear() {
      lastError = undefined;
    },
    show(error: string) {
      if (lastError === error || actions.stopped()) return;
      lastError = error;
      void dialog
        .showMessageBox(window, {
          type: "warning",
          message: es ? "La actualización de APX está bloqueada" : "APX update is blocked",
          detail: es
            ? `${error}\n\nLa app no se aplicó. Reconectate y elegí Buscar actualizaciones en el menú APX para reintentar. Si el servidor es anterior, actualizalo primero. Podés cambiar de conexión desde el menú APX.`
            : `${error}\n\nThe app was not applied. Reconnect and choose Check for updates in the APX menu to retry. If the server is older, update it first. You can change connections from the APX menu.`,
          buttons: [
            es ? "Reintentar" : "Retry",
            es ? "Cambiar conexión" : "Change connection",
            es ? "Más tarde" : "Later",
          ],
          defaultId: 0,
          cancelId: 2,
        })
        .then(async ({ response }) => {
          if (actions.stopped()) return;
          if (response === 0) await actions.retry();
          else if (response === 1) await actions.change();
        });
    },
  };
}

export function nativeUpdates(
  updater: ReturnType<typeof createDesktopUpdater>,
  window: BaseWindow,
  actions: { change(): Promise<void> },
) {
  const file = path.join(app.getPath("userData"), "pending-update.json");
  const credentials = updateCredentials(app.getPath("userData"), {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  });
  let active: NativeUpdateConnection | undefined;
  let stopped = false;
  const recovery = updateRecovery(window, {
    retry: async () => {
      await request();
    },
    change: actions.change,
    stopped: () => stopped,
  });
  const coordinator = createUpdateCoordinator({
    current: app.getVersion(),
    load: () => {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as PendingUpdate;
      } catch {
        return undefined;
      }
    },
    save: (pending) => {
      if (!pending) return fs.rmSync(file, { force: true });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(pending), { mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
    },
    stage: (target) => updater.install(target, !active?.local),
    activate: () => updater.restart(),
    now: Date.now,
    timeoutMs: 120_000,
    sleep: () => new Promise((resolve) => setTimeout(resolve, 1000)),
    failed: recovery.show,
  });

  function connect(connection: NativeUpdateConnection | undefined): void {
    if (active?.identity !== connection?.identity || active?.local !== connection?.local) updater.discard();
    active = connection;
    recovery.clear();
    if (!connection) {
      coordinator.connect(undefined);
      return;
    }
    const client = new ApxClient({
      url: connection.url,
      token: connection.token ?? credentials.read(connection.identity),
      client: { name: "apx-desktop", version: app.getVersion() },
      timeoutMs: 130_000,
    });
    const os = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : "linux";
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    coordinator.connect({
      identity: connection.identity,
      local: connection.local,
      health: () => client.call("system.health", {}),
      state: () => client.call("system.update_state", {}),
      prepare: (target) =>
        client.call("system.update_prepare", {
          target,
          desktop: { os, arch },
          ...(os === "mac" && updater.mode === "auto" ? { format: "zip" as const } : {}),
        }),
      apply: (target) => client.call("system.update", { target }),
    });
    void client
      .call("system.health", {})
      .then(async (health) => {
        if (health.protocol === PROTOCOL_VERSION) return;
        const state = await client.call("system.update_state", {}).catch(() => undefined);
        if (active === connection && !(state?.coordination_protocol === 1 && state.supported))
          recovery.show("This server uses an incompatible protocol. Update the server before this app.");
      })
      .catch(() => {});
    void coordinator.reconcile();
  }
  async function request() {
    let target = updater.status().ready ?? updater.status().latest;
    if (!target) target = (await updater.check()).latest;
    return coordinator.install(target);
  }

  const timer = setInterval(() => void coordinator.reconcile(), 30_000);
  timer.unref();

  return {
    ...updater,
    connect,
    authenticate(token: string | undefined, origin: string): void {
      if (!active || active.local || new URL(active.url).origin !== origin) return;
      credentials.write(active.identity, token);
      connect({ ...active, ...(token ? { token } : { token: undefined }) });
    },
    automatic: () => active?.local === true,
    install: request,
    panelUnavailable() {
      if (active && !active.local)
        recovery.show("The remote panel could not load. Retry the coordinated update or choose another connection.");
    },
    restart: () => {
      void coordinator.restart();
    },
    quitting: () => {
      if (coordinator.canApplyOnQuit()) updater.quitting();
    },
    stop: () => {
      stopped = true;
      clearInterval(timer);
      updater.stop();
    },
  };
}
