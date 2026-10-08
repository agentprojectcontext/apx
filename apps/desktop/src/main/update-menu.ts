// The update as the app menu says it ("Check for updates…", "Update to APX 2.3.0…", "Restart to update to APX 2.3.0")
// and the native questions it asks when the owner started it there: restart now or later.
import { type BaseWindow, dialog, type MenuItemConstructorOptions, Notification } from "electron";
import type { createDesktopUpdater, DesktopUpdate } from "./updater.ts";

type Updater = ReturnType<typeof createDesktopUpdater>;

const words = (es: boolean, platform: string) => ({
  check: es ? "Buscar actualizaciones…" : "Check for updates…",
  update: (v: string) => (es ? `Actualizar a APX ${v}…` : `Update to APX ${v}…`),
  downloading: (v: string) => (es ? `Descargando APX ${v}…` : `Downloading APX ${v}…`),
  restart: (v: string) => (es ? `Reiniciar para actualizar a APX ${v}` : `Restart to update to APX ${v}`),
  readyTitle: (v: string) => (es ? `APX ${v} está listo` : `APX ${v} is ready`),
  readyDetail:
    platform === "win32"
      ? es
        ? "Se instala al reiniciar APX. Si elegís más tarde, queda en el menú APX: Reiniciar para actualizar."
        : "It goes in when APX restarts. If you choose later, it waits in the APX menu: Restart to update."
      : es
        ? "Se instala al reiniciar APX. Si elegís más tarde, se instala cuando salgas de APX."
        : "It goes in when APX restarts. If you choose later, it goes in when you quit APX.",
  restartNow: es ? "Reiniciar ahora" : "Restart now",
  later: es ? "Más tarde" : "Later",
  upToDate: es ? "APX está al día" : "APX is up to date",
  version: (v: string) => (es ? `Tenés la versión ${v}.` : `You have version ${v}.`),
  failed: es ? "No se pudo actualizar APX" : "APX could not update",
  noFeed: es ? "No se pudo consultar si hay una versión nueva." : "Could not ask whether a newer version is out.",
  dragged: (v: string) =>
    es
      ? `Se abrió APX ${v}: arrastralo a Aplicaciones, reemplazando este, y abrilo de nuevo.`
      : `APX ${v} opened: drag it into Applications, replacing this one, and open it again.`,
  readyNote: (v: string) =>
    es ? `APX ${v} está listo. Reiniciá APX para usarlo.` : `APX ${v} is ready. Restart APX to use it.`,
  outNote: (v: string) => (es ? `Salió APX ${v}. Abrí APX para actualizar.` : `APX ${v} is out. Open APX to update.`),
  ok: es ? "Aceptar" : "OK",
});

export function createUpdateMenu(opts: { updater: Updater; window: BaseWindow; es: boolean; platform: string }) {
  const { updater, window } = opts;
  const t = words(opts.es, opts.platform);
  let told: string | undefined;

  async function askRestart(version: string): Promise<void> {
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      message: t.readyTitle(version),
      detail: t.readyDetail,
      buttons: [t.restartNow, t.later],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) updater.restart();
  }

  async function update(version: string): Promise<void> {
    const r = await updater.install();
    if (!r.ok) {
      await dialog.showMessageBox(window, { type: "warning", message: t.failed, detail: r.error, buttons: [t.ok] });
      return;
    }
    if (r.ready) await askRestart(version);
    else await dialog.showMessageBox(window, { type: "info", message: t.dragged(version), buttons: [t.ok] });
  }

  async function checkNow(): Promise<void> {
    const s = await updater.check();
    if (s.latest) return update(s.latest);
    await dialog.showMessageBox(window, {
      type: s.error ? "warning" : "info",
      message: s.error ? t.failed : t.upToDate,
      detail: s.error ? `${t.noFeed}\n${s.error}` : t.version(s.current),
      buttons: [t.ok],
    });
  }

  return {
    /** The app menu's update entry, as things stand now; none where the app does not update itself (a checkout). */
    item(s: DesktopUpdate): MenuItemConstructorOptions | undefined {
      if (!updater.enabled) return undefined;
      if (s.ready) return { id: "update", label: t.restart(s.ready), click: () => updater.restart() };
      if (s.downloading && s.latest) return { id: "update", label: t.downloading(s.latest), enabled: false };
      const latest = s.latest;
      if (latest) return { id: "update", label: t.update(latest), click: () => void update(latest) };
      return { id: "update", label: t.check, click: () => void checkNow() };
    },
    /** A background check found a newer APX: auto mode downloads it and says once it is ready; drag mode says it is out. */
    found(s: DesktopUpdate) {
      const latest = s.latest;
      if (!latest || told === latest) return;
      told = latest;
      const notify = (body: string, click?: () => void) => {
        if (!Notification.isSupported()) return;
        const n = new Notification({ title: "APX", body });
        if (click) n.on("click", click);
        n.show();
      };
      if (updater.mode !== "auto") return notify(t.outNote(latest));
      void updater.install().then((r) => {
        if (r.ok && r.ready) notify(t.readyNote(latest), () => void askRestart(latest));
      });
    },
  };
}
