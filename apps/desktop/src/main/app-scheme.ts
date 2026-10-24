// The panel's own build, served to the window as apx-app://app/… without any core: the first-run page (server or
// client) is the same web app, with the same design, before an APX is chosen.
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, net, protocol, session } from "electron";

export const APP_SCHEME = "apx-app";
export const FIRST_RUN_URL = `${APP_SCHEME}://app/index.html?connect`;

/** Before the app is ready: the scheme behaves like https (modules, fetch, storage). */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

/** The built panel the app carries (installed) or the checkout's (pnpm app). */
export function webDist(dist: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "apx", "apps", "web", "dist")
    : path.resolve(dist, "../../web/dist");
}

/** Serves files of `root` only; anything outside it, or a path that is not a file, is a 404. */
export function serveAppScheme(partition: string, root: string): void {
  session.fromPartition(partition).protocol.handle(APP_SCHEME, (req) => {
    const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "") || "index.html";
    const file = path.resolve(root, rel);
    // path.relative compares as the system does (any case on Windows).
    const up = path.relative(root, file);
    if (up === ".." || up.startsWith(`..${path.sep}`) || path.isAbsolute(up))
      return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href).catch(() => new Response("not found", { status: 404 }));
  });
}
