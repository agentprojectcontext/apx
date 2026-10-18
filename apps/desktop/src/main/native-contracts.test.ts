import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import type { BaseWindow, MenuItemConstructorOptions } from "electron";
import type { createDesktopUpdater, DesktopUpdate } from "./updater.ts";

const messages: Record<string, unknown>[] = [];
let response = 1;
let supported = true;
const notices: Notice[] = [];
class Notice {
  static isSupported() {
    return supported;
  }
  listener?: () => void;
  shown = false;
  readonly options: { title: string; body: string };
  constructor(options: { title: string; body: string }) {
    this.options = options;
    notices.push(this);
  }
  on(event: string, listener: () => void) {
    assert.equal(event, "click");
    this.listener = listener;
  }
  show() {
    this.shown = true;
  }
}
const native = {
  dialog: {
    showMessageBox: async (_win: unknown, options: Record<string, unknown>) => {
      messages.push(options);
      return { response };
    },
    showMessageBoxSync: (_win: unknown, options: Record<string, unknown>) => {
      messages.push(options);
      return response;
    },
  },
  Notification: Notice,
};
const boundary = Symbol.for("apx.test.native");
Object.assign(globalThis, { [boundary]: native });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "electron")
      return {
        url: `data:text/javascript,${encodeURIComponent('const n = globalThis[Symbol.for("apx.test.native")]; export const dialog = n.dialog; export const Notification = n.Notification;')}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { createUpdateMenu } = await import("./update-menu.ts");
const { confirmQuit } = await import("./quit-confirm.ts");
hooks.deregister();
Reflect.deleteProperty(globalThis, boundary);

const window = {} as BaseWindow;
const initial: DesktopUpdate = { current: "2.0.0", notes: [], install: "auto" };
function harness(options: { es?: boolean; platform?: string; enabled?: boolean; mode?: "auto" | "drag" } = {}) {
  messages.length = 0;
  notices.length = 0;
  response = 1;
  supported = true;
  let checks = 0;
  let installs = 0;
  let restarts = 0;
  let status: DesktopUpdate = initial;
  let result: Awaited<ReturnType<ReturnType<typeof createDesktopUpdater>["install"]>> = { ok: true, ready: true };
  const updater = {
    enabled: options.enabled ?? true,
    mode: options.mode ?? "auto",
    check: async () => {
      checks++;
      return status;
    },
    install: async () => {
      installs++;
      return result;
    },
    restart: () => {
      restarts++;
    },
  } as ReturnType<typeof createDesktopUpdater>;
  const menu = createUpdateMenu({ updater, window, es: options.es ?? false, platform: options.platform ?? "linux" });
  return {
    menu,
    counts: () => ({ checks, installs, restarts }),
    status: (s: DesktopUpdate) => {
      status = s;
    },
    result: (r: typeof result) => {
      result = r;
    },
  };
}
async function click(item: MenuItemConstructorOptions | undefined) {
  assert.ok(item?.click);
  item.click(
    {} as Parameters<NonNullable<typeof item.click>>[0],
    window,
    {} as Parameters<NonNullable<typeof item.click>>[2],
  );
  // Drain the promise chain started by the native menu callback.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("update menu hides unsupported updates and disables downloads without offering a second install", () => {
  const disabled = harness({ enabled: false });
  assert.equal(disabled.menu.item(initial), undefined);
  const h = harness();
  const downloading = h.menu.item({ ...initial, latest: "2.1.0", downloading: true });
  assert.equal(downloading?.enabled, false);
  assert.equal(downloading?.label, "Downloading APX 2.1.0…");
  assert.equal(downloading?.click, undefined);
  assert.deepEqual(h.counts(), { checks: 0, installs: 0, restarts: 0 });
});

test("manual checks distinguish current versions and feed failures without starting installation", async () => {
  const h = harness();
  await click(h.menu.item(initial));
  assert.equal(messages[0]?.message, "APX is up to date");
  assert.equal(messages[0]?.detail, "You have version 2.0.0.");
  h.status({ ...initial, error: "Offline" });
  await click(h.menu.item(initial));
  assert.equal(messages[1]?.type, "warning");
  assert.match(String(messages[1]?.detail), /Offline/);
  assert.deepEqual(h.counts(), { checks: 2, installs: 0, restarts: 0 });
});

test("a new release installs from check, defers restart, and remains available in the menu", async () => {
  const h = harness({ es: true, platform: "win32" });
  h.status({ ...initial, latest: "2.1.0" });
  await click(h.menu.item(initial));
  assert.equal(messages[0]?.message, "APX 2.1.0 está listo");
  assert.match(String(messages[0]?.detail), /queda en el menú APX/);
  assert.deepEqual(messages[0]?.buttons, ["Reiniciar ahora", "Más tarde"]);
  assert.deepEqual(h.counts(), { checks: 1, installs: 1, restarts: 0 });
  await click(h.menu.item({ ...initial, ready: "2.1.0" }));
  assert.equal(h.counts().restarts, 1);
});

test("an explicit release installs and restarts only with consent", async () => {
  const h = harness();
  response = 0;
  await click(h.menu.item({ ...initial, latest: "2.1.0" }));
  assert.deepEqual(h.counts(), { checks: 0, installs: 1, restarts: 1 });
  assert.match(String(messages[0]?.detail), /when you quit APX/);
});

test("install failures show the reason; drag updates explain manual replacement instead of restarting", async () => {
  const h = harness();
  h.result({ ok: false, error: "Checksum mismatch" });
  await click(h.menu.item({ ...initial, latest: "2.1.0" }));
  assert.equal(messages[0]?.type, "warning");
  assert.equal(messages[0]?.detail, "Checksum mismatch");
  h.result({ ok: true, ready: false });
  await click(h.menu.item({ ...initial, latest: "2.1.0" }));
  assert.match(String(messages[1]?.message), /drag it into Applications/);
  assert.equal(h.counts().restarts, 0);
});

test("background releases notify once per version and notification clicks ask before restart", async () => {
  const h = harness();
  h.menu.found(initial);
  h.menu.found({ ...initial, latest: "2.1.0" });
  h.menu.found({ ...initial, latest: "2.1.0" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.counts().installs, 1);
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.shown, true);
  assert.equal(notices[0]?.options.body, "APX 2.1.0 is ready. Restart APX to use it.");
  response = 0;
  notices[0]?.listener?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(h.counts().restarts, 1);
  h.menu.found({ ...initial, latest: "2.2.0" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(notices.length, 2);
});

test("background failures and unsupported notifications stay silent; drag mode never auto-installs", async () => {
  const h = harness();
  h.result({ ok: false, error: "Offline" });
  h.menu.found({ ...initial, latest: "2.1.0" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(notices.length, 0);
  supported = false;
  h.result({ ok: true, ready: true });
  h.menu.found({ ...initial, latest: "2.2.0" });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(notices.length, 0);
  const drag = harness({ mode: "drag", es: true });
  drag.menu.found({ ...initial, latest: "2.1.0" });
  assert.equal(drag.counts().installs, 0);
  assert.equal(notices[0]?.options.body, "Salió APX 2.1.0. Abrí APX para actualizar.");
  assert.equal(notices[0]?.listener, undefined);
});

test("quit confirmation defaults to quit but Escape cancels and warns about local core shutdown only", () => {
  harness();
  assert.equal(confirmQuit(window, { es: false, runsCore: false }), false);
  assert.equal(messages[0]?.message, "Quit APX?");
  assert.equal(messages[0]?.detail, "The browser tabs your agents use close.");
  assert.equal(messages[0]?.cancelId, 1);
  response = 0;
  assert.equal(confirmQuit(window, { es: true, runsCore: true }), true);
  assert.match(String(messages[1]?.detail), /rutinas y los canales esperan/);
  assert.deepEqual(messages[1]?.buttons, ["Salir", "Cancelar"]);
});
