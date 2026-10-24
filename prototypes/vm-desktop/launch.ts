import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../apps/core/src/config.ts";
import { createCore } from "../../apps/core/src/server.ts";
import { ApxClient } from "../../packages/protocol/src/client.ts";
import { demoModel } from "./model.ts";

const root = path.resolve(import.meta.dirname, "../..");
const runtime = path.resolve(process.argv[2] ?? "");
const real = process.argv.includes("--real");
const chosenModel = process.argv.find((arg) => arg.startsWith("--model="))?.slice(8) ?? "chatgpt/gpt-6.1-sol";
if (!path.basename(runtime).startsWith("apx-vm-lab-")) throw new Error("Pass a dedicated scratch apx-vm-lab-* folder");
if (process.env.APX_VM_LAB_CHILD !== runtime) {
  const empty = path.join(runtime, "empty");
  fs.mkdirSync(empty, { recursive: true });
  const child = spawn(process.execPath, [import.meta.filename, ...process.argv.slice(2)], {
    cwd: root,
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      HOME: empty,
      CODEX_HOME: path.join(empty, "codex"),
      CLAUDE_CONFIG_DIR: path.join(empty, "claude"),
      APX_VM_LAB_CHILD: runtime,
    },
  });
  process.once("SIGINT", () => child.kill("SIGINT"));
  process.once("SIGTERM", () => child.kill("SIGTERM"));
  const code = await new Promise<number>((resolve) => child.once("exit", (status) => resolve(status ?? 1)));
  process.exit(code);
}
const env = { PATH: process.env.PATH, HOME: process.env.HOME, LIMA_HOME: path.join(runtime, "lima") };
const home = path.join(runtime, real ? "core-real" : "core");
fs.mkdirSync(home, { recursive: true });
const config = loadConfig(
  {
    APX_HOME: home,
    APX_PORT: "0",
    APX_AGENT_NAME: "Nova · VM Lab",
    APX_SECRETS: "file",
    APX_APPS_HOME: path.join(runtime, "empty"),
    CLAUDE_CONFIG_DIR: path.join(runtime, "empty/claude"),
    CODEX_HOME: path.join(runtime, "empty/codex"),
    APX_IMESSAGE: "off",
    APX_HEADLESS: "off",
    APX_UPDATES: "off",
    APX_WHATS_NEW: "off",
    APX_RUNTIME_SKILLS: "off",
    APX_TELEMETRY: "off",
    ...(!real ? { APX_LLM_BASE_URL: "http://127.0.0.1:9/v1", APX_LLM_KEY: "demo", APX_LLM_MODELS: "vm-demo" } : {}),
    APX_OLLAMA_URL: "http://127.0.0.1:9",
  },
  false,
);
const core = await createCore(config, {
  ...(!real ? { llm: demoModel } : {}),
  computer: {
    managed: true,
    demo: true,
    limaHome: env.LIMA_HOME,
    instance: "apx-lab",
    ...(real ? { model: chosenModel } : {}),
  },
  imessage: null,
});
const client = new ApxClient({ url: core.url });
await client.call("setup.finish", {});
await client.call("owner.set", { name: "Alex", about: "Acme demo workspace", language: "es" });
await client.call("projects.update_base", { name: "Acme · VM Lab", kind: "personal" });
await client.call("agents.update", {
  agent: "roby",
  name: "Nova · VM Lab",
  role: "Computadora Linux de prueba",
  tools: real
    ? ["shell", "browser_open", "browser_snapshot", "browser_text", "browser_click", "browser_type"]
    : ["shell"],
  browser_profile: "shared",
  autonomy: "total",
  model_choice: { model: real ? chosenModel : "custom/vm-demo", router: false },
  prompt: real
    ? "You are Nova, a real APX agent working in a disposable Linux VM. Answer in Spanish. Your shell and browser tools execute ONLY inside the VM; the owner watches the same desktop in the Computer panel. Work in ~/work (your own user on the shared computer). A fictitious Acme dashboard is available at http://127.0.0.1:8080/acme.html. Use browser_open/snapshot/click/type for visible browsing and shell for guest commands. Do not assume host paths in the generic context exist in your VM. The terminal window mirrors your shell commands. You have no personal logins. Never request API keys or passwords in chat. Do not install or use host integrations. If a browser or shell call fails, diagnose and retry recoverable errors using the available tools. Stop only for missing user input, permissions, or an external condition you cannot resolve. Check intermediate command failures (for example with set -e) and verify the requested result before claiming completion. Use browser tools to navigate and extract page links; download selected images as binary files without decoding their bytes as text. For a browser demo, open the local dashboard, inspect its contents, write a short report using shell, and describe what you actually observed."
    : "You are a scripted demo in a disposable Linux VM. All sample data is fictitious. Use shell only. Never imply you interpret free-form requests.",
});
await client.call("environments.permit", { agent: "roby", on: true });
await client.call("environments.bind", { thread: "home" });
const welcome = core.store.messages.list("home");
const mode = real ? "real" : "scripted";
if (!welcome.length || core.store.settings.get("vm_welcome_mode") !== mode) {
  core.store.messages.add({
    thread_id: "home",
    author: { kind: "agent", id: "roby" },
    parts: [
      {
        type: "text",
        text: real
          ? "Agente real conectado. Pedime tareas por chat: usaré navegador y terminal dentro de mi VM. Mirá mis acciones en Computadora. Podés pedirme: ‘Abrí el dashboard de Acme, revisá los datos y guardá un informe en el escritorio’. Datos ficticios; llamadas al modelo usan tu proveedor configurado en APX."
          : "Computadora Linux lista. A la derecha ves mi escritorio real. Botón ‘Ver demo del agente’ ejecuta recorrido programado: revisar sistema, crear informe ficticio y abrir navegador y terminal. También podés escribir comandos abajo o usar directamente teclado y mouse dentro del escritorio. Sin cuentas personales ni API paga.",
      },
    ],
  });
  core.store.settings.set("vm_welcome_mode", mode);
}
const url = `${core.url}/#thread=home&panel=computer`;
fs.writeFileSync(
  path.join(runtime, "running.json"),
  JSON.stringify(
    { url, home, pid: process.pid, code_sha: core.identity.code_sha, model: real ? chosenModel : undefined },
    null,
    2,
  ),
);
process.stdout.write(`\nVM prototype: ${url}\nRuntime: ${runtime}\n`);

let desktop: ReturnType<typeof spawn> | undefined;
if (!process.argv.includes("--no-desktop")) {
  const pkg = fs.realpathSync(path.join(root, "apps/desktop/node_modules/electron/package.json"));
  const source = path.join(path.dirname(pkg), "dist/Electron.app");
  const app = path.join(runtime, "APX VM Lab.app");
  if (!fs.existsSync(app)) execFileSync("cp", ["-R", source, app]);
  for (const key of ["CFBundleName", "CFBundleDisplayName"])
    execFileSync("plutil", ["-replace", key, "-string", "APX VM Lab", path.join(app, "Contents/Info.plist")]);
  execFileSync("plutil", [
    "-replace",
    "CFBundleIdentifier",
    "-string",
    "com.apx.vm-lab",
    path.join(app, "Contents/Info.plist"),
  ]);
  const entry = path.join(runtime, "desktop.cjs");
  fs.writeFileSync(
    entry,
    `const { app } = require('electron');
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    if (!window.webContents.getURL().startsWith(${JSON.stringify(core.url)})) return;
    await window.webContents.executeJavaScript('localStorage.setItem("apx.prefs", JSON.stringify({ language: "es", panelW: 1000, sidebarCollapsed: true }))');
    window.webContents.reload();
  });
});
void import(${JSON.stringify(path.join(root, "apps/desktop/dist/main.js"))}).then(() => app.setName('APX VM Lab'));`,
  );
  desktop = spawn(path.join(app, "Contents/MacOS/Electron"), [entry, "--remote-debugging-port=0"], {
    stdio: "inherit",
    env: {
      ...process.env,
      HOME: path.join(runtime, "empty"),
      APX_DESKTOP_DATA: path.join(runtime, "desktop"),
      APX_HOME: home,
      APX_CONNECTION: "url",
      APX_URL: core.url,
      APX_WEB_URL: url,
      APX_QUIT_CONFIRM: "off",
      APX_UPDATES: "off",
    },
  });
}
const stop = async () => {
  desktop?.kill();
  await core.close();
  process.exit(0);
};
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
