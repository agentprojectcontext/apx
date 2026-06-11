// Tool routers — every adapter lives in core/tools/. Mount order matters:
//   fetch  = native HTTP, no Chromium       → cheap default for REST/HTML
//   browser = Puppeteer-backed              → heavy, lazy-launched, JS-rendered
//   search / glob / grep                    → filesystem-bounded
//   registry                                → /:name wildcard, MOUNT LAST so it
//                                             doesn't shadow the specific paths
import { buildBrowserRouter } from "#core/http-tools/browser.js";
import { buildFetchRouter } from "#core/http-tools/fetch.js";
import { buildSearchRouter } from "#core/http-tools/search.js";
import { buildRegistryRouter } from "#core/http-tools/registry.js";
import { buildGlobRouter } from "#core/http-tools/glob.js";
import { buildGrepRouter } from "#core/http-tools/grep.js";

export function register(app, { express, projects, registries }) {
  app.use("/tools/fetch", buildFetchRouter(express));
  app.use("/tools/browser", buildBrowserRouter(express));
  app.use("/tools/search", buildSearchRouter(express));
  app.use("/tools/glob", buildGlobRouter(express));
  app.use("/tools/grep", buildGrepRouter(express));
  app.use("/tools", buildRegistryRouter(express, { projects, registries }));
}
