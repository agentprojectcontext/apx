// Lets APX's extension in the owner's Chrome reach this core: `apx chrome-host` registered as a native messaging host
// that only the extension's exact origin may start. Written at every start, like the `apx` command, so it follows the
// core when it moves. See DECISIONS.md#d-198
import fs from "node:fs";
import path from "node:path";
import { CHROME_EXTENSION_ORIGIN, CHROME_HOST } from "@apx/protocol";
import { type CommandRunner, quoteSh } from "../harness/apx-command.ts";

/** Where each Chrome-family browser looks for a user's native hosts: `<its data folder>/NativeMessagingHosts`. */
export function browserDataDirs(home: string, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return [
      "Google/Chrome",
      "Google/Chrome Beta",
      "Google/Chrome Canary",
      "Chromium",
      "BraveSoftware/Brave-Browser",
      "Microsoft Edge",
      "Arc/User Data",
    ].map((d) => path.join(support, d));
  }
  if (platform === "linux") {
    const config = path.join(home, ".config");
    return ["google-chrome", "google-chrome-beta", "chromium", "BraveSoftware/Brave-Browser", "microsoft-edge"].map(
      (d) => path.join(config, d),
    );
  }
  return [];
}

const writeIfChanged = (file: string, text: string, mode?: number) => {
  let same = false;
  try {
    same = fs.readFileSync(file, "utf8") === text;
  } catch {}
  if (!same) fs.writeFileSync(file, text, mode === undefined ? {} : { mode });
  if (mode !== undefined) fs.chmodSync(file, mode);
};

/**
 * Writes `<home>/bin/apx-chrome-host` and its manifest into every browser here that has a data folder; a browser
 * installed later gets it on the next start. Returns the manifests written. Windows registers through the registry,
 * which this does not do yet.
 */
export function installChromeHost(opts: {
  home: string;
  port: number;
  runner: CommandRunner;
  /** The browsers' data folders (browserDataDirs); only those that exist get the manifest. */
  browsers: readonly string[];
  platform?: NodeJS.Platform;
}): string[] {
  if ((opts.platform ?? process.platform) === "win32" || !fs.existsSync(opts.runner.main)) return [];
  const present = opts.browsers.filter((d) => fs.existsSync(d));
  if (!present.length) return [];
  const bin = path.join(opts.home, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const launcher = path.join(bin, "apx-chrome-host");
  writeIfChanged(
    launcher,
    [
      "#!/bin/sh",
      "# Started by Chrome for APX's extension, written by the APX core at start.",
      ...(opts.runner.electron ? ["export ELECTRON_RUN_AS_NODE=1"] : []),
      `export APX_HOME=${quoteSh(opts.home)}`,
      `export APX_PORT=${opts.port}`,
      `exec ${quoteSh(opts.runner.exe)} --disable-warning=ExperimentalWarning ${quoteSh(opts.runner.main)} chrome-host "$@"`,
      "",
    ].join("\n"),
    0o755,
  );
  const manifest = `${JSON.stringify(
    {
      name: CHROME_HOST,
      description: "APX",
      path: launcher,
      type: "stdio",
      allowed_origins: [CHROME_EXTENSION_ORIGIN],
    },
    null,
    2,
  )}\n`;
  return present.map((dir) => {
    const hosts = path.join(dir, "NativeMessagingHosts");
    fs.mkdirSync(hosts, { recursive: true });
    const file = path.join(hosts, `${CHROME_HOST}.json`);
    writeIfChanged(file, manifest);
    return file;
  });
}
