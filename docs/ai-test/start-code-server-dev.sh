#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$script_dir/../.." && pwd)"
config_file="$script_dir/code-server.local.env"

if [[ ! -f "$config_file" ]]; then
  echo "Missing $config_file"
  echo "Copy code-server.local.env.example and set your code-server host and proxy base."
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$config_file"
set +a

if [[ -z "${APX_CODE_SERVER_HOST:-}" || -z "${APX_CODE_SERVER_BASE:-}" ]]; then
  echo "APX_CODE_SERVER_HOST and APX_CODE_SERVER_BASE are required in $config_file"
  exit 1
fi

if [[ "$APX_CODE_SERVER_BASE" != /*/ ]]; then
  echo "APX_CODE_SERVER_BASE must start and end with '/'."
  exit 1
fi

core_pid=""
web_pid=""
dev_token="$(node --input-type=module -e 'import { randomBytes } from "node:crypto"; process.stdout.write(randomBytes(32).toString("hex"))')"

stop_services() {
  trap - EXIT INT TERM
  [[ -n "$web_pid" ]] && kill "$web_pid" 2>/dev/null || true
  [[ -n "$core_pid" ]] && kill "$core_pid" 2>/dev/null || true
  [[ -n "$web_pid" ]] && wait "$web_pid" 2>/dev/null || true
  [[ -n "$core_pid" ]] && wait "$core_pid" 2>/dev/null || true
}

trap stop_services EXIT INT TERM

cd "$repo_dir"
APX_TOKEN="$dev_token" \
NODE_COMPILE_CACHE="${NODE_COMPILE_CACHE:-$repo_dir/node_modules/.cache/node-compile}" \
  node --watch apps/core/src/main.ts &
core_pid=$!

cd "$repo_dir/apps/web"
APX_CODE_SERVER_DEV_TOKEN="$dev_token" \
__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="$APX_CODE_SERVER_HOST" \
  node --input-type=module -e '
    import { createServer } from "vite";

    const base = process.env.APX_CODE_SERVER_BASE;
    const core = "http://127.0.0.1:7440";
    const token = process.env.APX_CODE_SERVER_DEV_TOKEN;
    const proxy = (ws = false) => ({
      target: ws ? core.replace(/^http/, "ws") : core,
      ws,
      changeOrigin: true,
      headers: { authorization: `Bearer ${token}` },
      configure(server) {
        const localOrigin = "http://127.0.0.1:7441";
        server.on("proxyReq", (request) => request.setHeader("origin", localOrigin));
        server.on("proxyReqWs", (request) => request.setHeader("origin", localOrigin));
      },
    });
    const bridge = {
      name: "code-server-path-bridge",
      transform(code, id) {
        const file = id.split("?", 1)[0];
        if (file.endsWith("/src/data/client.ts")) {
          return code.replace(
            "url: window.location.origin,",
            "url: window.location.origin + import.meta.env.BASE_URL.replace(/\\\/$/, \"\"),",
          );
        }
        if (file.endsWith("/src/config/AccessBlock.tsx")) {
          return code.replace(`fetch("/health",`, "fetch(`${import.meta.env.BASE_URL}health`,");
        }
      },
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const proxied = ["/rpc/", "/health", "/a/", "/_apx/", "/ws"];
          if (
            request.url?.startsWith("/") &&
            !request.url.startsWith(base) &&
            !proxied.some((prefix) => request.url.startsWith(prefix))
          ) {
            request.url = base.slice(0, -1) + request.url;
          }
          next();
        });
      },
    };

    const server = await createServer({
      configFile: "./vite.config.ts",
      base,
      plugins: [bridge],
      server: {
        host: "0.0.0.0",
        port: 7441,
        proxy: {
          "/rpc": proxy(),
          "/health": proxy(),
          "/a/": proxy(),
          "/_apx/": proxy(),
          "/ws": proxy(true),
        },
      },
    });

    await server.listen();
    server.printUrls();
  ' &
web_pid=$!

echo
echo "APX development services are running. Press Ctrl+C to stop both."
echo "Open: https://${APX_CODE_SERVER_HOST}${APX_CODE_SERVER_BASE}"
echo

wait -n "$core_pid" "$web_pid"
