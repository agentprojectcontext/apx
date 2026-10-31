import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { test as base } from "@playwright/test";
import { isInside } from "../../../apps/core/src/paths.ts";
import { tempDir } from "../../../apps/core/src/testkit/platform.ts";
import { assembleSite } from "../../../apps/docs/scripts/assemble-site.mjs";

export const test = base.extend<Record<never, never>, { assembledOrigin: string }>({
  assembledOrigin: [
    async ({ browserName }, use) => {
      const v1 = process.env.DOCS_V1_DIST;
      if (!v1)
        throw new Error(
          "Set DOCS_V1_DIST to a real v1 docs build (DOCS_BASE=/v1). No fixture substitutes the historical site.",
        );
      const dir = tempDir(`apx-assembled-${browserName}-`);
      const out = join(dir.path, "site");
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
      };
      const server = createServer((request, response) => {
        void (async () => {
          if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405).end();
            return;
          }
          let file = resolve(out, `.${decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname)}`);
          if (!isInside(out, file)) {
            response.writeHead(403).end();
            return;
          }
          let code = 200;
          try {
            if ((await stat(file)).isDirectory()) file = join(file, "index.html");
            await stat(file);
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
            file = join(out, "404.html");
            code = 404;
          }
          const body = await readFile(file);
          response.writeHead(code, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
          response.end(request.method === "HEAD" ? undefined : body);
        })().catch(() => response.writeHead(500).end());
      });
      try {
        await assembleSite({ v1: resolve(v1), v2: resolve("apps/docs/dist"), out });
        await new Promise<void>((done, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", done);
        });
        const address = server.address();
        if (!address || typeof address === "string") throw new Error("No preview address");
        await use(`http://127.0.0.1:${address.port}`);
      } finally {
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
        await dir.remove();
      }
    },
    { scope: "worker" },
  ],
});
export { expect } from "@playwright/test";
