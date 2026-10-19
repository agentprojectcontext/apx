import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDesktopInstaller, type DesktopInstallOptions } from "./desktop.ts";
import { desktopDataDir, hasDesktop } from "./paths.ts";
import type { ProcessRunner } from "./process.ts";

function fixture(overrides: Partial<DesktopInstallOptions> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "apx-install-test-"));
  const app = path.join(home, "Applications", overrides.platform === "darwin" ? "APX.app" : "APX.AppImage");
  const coreHome = path.join(home, "core");
  fs.mkdirSync(coreHome);
  fs.writeFileSync(path.join(coreHome, "home-id"), "selected-home");
  const bytes = Buffer.from("desktop binary");
  const name = "APX-2.9.1-linux-x64.AppImage";
  const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const requests: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("/releases?"))
      return Response.json([
        {
          tag_name: "v2.9.1",
          assets: [name, `${name}.sha256`].map((asset) => ({
            name: asset,
            browser_download_url: `https://releases.example/${asset}`,
          })),
        },
      ]);
    if (url.endsWith(".sha256")) return new Response(createHash("sha256").update(bytes).digest("hex"));
    return new Response(bytes, { headers: { "content-length": String(bytes.length) } });
  };
  const run: ProcessRunner = async (command, args, options) => {
    calls.push({ command, args, env: options.env });
  };
  const installer = createDesktopInstaller({
    platform: "linux",
    arch: "x64",
    userHome: home,
    env: {
      DISPLAY: ":1",
      APX_DESKTOP_DATA: path.join(home, "desktop"),
      APX_URL: "https://other.example",
      APX_TOKEN: "private",
      ELECTRON_RUN_AS_NODE: "1",
    },
    feed: "https://releases.example",
    candidates: [app],
    fetch: fakeFetch,
    run,
    target: () => ({ home: coreHome, port: 7550, home_id: "selected-home" }),
    ...overrides,
  });
  return {
    home,
    app,
    coreHome,
    bytes,
    calls,
    requests,
    installer,
    fakeFetch,
    async close() {
      await installer.close();
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

test("missing desktop downloads once, reports bytes, installs, and opens the selected local APX", async () => {
  const progress: number[] = [];
  const f = fixture({
    changed: (s) => {
      if (s.total) progress.push(s.received);
    },
  });
  try {
    assert.equal(f.installer.status().installed, false);
    f.installer.start();
    f.installer.start();
    const result = await f.installer.wait();
    assert.equal(result.phase, "ready");
    assert.equal(result.installed, true);
    assert.equal(result.received, f.bytes.length);
    assert.ok(progress.includes(f.bytes.length));
    assert.equal(f.requests.filter((r) => r.includes("/releases?")).length, 1);
    assert.deepEqual(fs.readFileSync(f.app), f.bytes);
    fs.accessSync(f.app, fs.constants.X_OK);
    assert.ok(fs.readFileSync(path.join(f.home, ".local/share/applications/apx.desktop"), "utf8").includes(f.app));
    assert.match(
      fs.readFileSync(path.join(f.home, ".local/share/applications/apx.desktop"), "utf8"),
      /^\[Desktop Entry\]\nType=Application\n/,
    );
    const saved = JSON.parse(fs.readFileSync(path.join(f.home, "desktop/connection.json"), "utf8"));
    assert.equal(saved.home, fs.realpathSync(f.coreHome));
    assert.equal(saved.port, 7550);
    assert.equal(saved.home_id, "selected-home");
    assert.equal(saved.token, undefined);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]?.command, f.app);
    assert.deepEqual(f.calls[0]?.args, ["--apx-adopt-local"]);
    assert.equal(f.calls[0]?.env.APX_TOKEN, undefined);
    assert.equal(f.calls[0]?.env.APX_URL, undefined);
    assert.equal(f.calls[0]?.env.ELECTRON_RUN_AS_NODE, undefined);
  } finally {
    await f.close();
  }
});

test("an existing app is preserved and opened without network or a second installation", async () => {
  const f = fixture();
  try {
    fs.mkdirSync(path.dirname(f.app));
    fs.writeFileSync(f.app, "existing");
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.equal(f.requests.length, 0);
    assert.equal(fs.readFileSync(f.app, "utf8"), "existing");
    assert.equal(f.calls[0]?.command, f.app);
  } finally {
    await f.close();
  }
});

test("temporary cleanup failure cannot crash the daemon and retry opens the installed app", async (t) => {
  const f = fixture();
  const remove = fs.rmSync;
  const leftovers: fs.PathLike[] = [];
  t.mock.method(fs, "rmSync", (file: fs.PathLike, options?: fs.RmOptions) => {
    if (path.basename(String(file)).startsWith("apx-desktop-install-")) {
      leftovers.push(file);
      throw new Error("Temporary download is locked");
    }
    return remove(file, options);
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "failed");
    assert.match(f.installer.status().error ?? "", /locked/);
    assert.equal(f.installer.status().installed, true);
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
  } finally {
    t.mock.restoreAll();
    for (const file of leftovers) remove(file, { recursive: true, force: true });
    await f.close();
  }
});

test("a bad checksum never installs or launches and the next attempt recovers", async () => {
  let broken = true;
  const f = fixture({
    fetch: async (input, init) =>
      String(input).endsWith(".sha256") && broken ? new Response("0".repeat(64)) : f.fakeFetch(input, init),
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "failed");
    assert.match(f.installer.status().error ?? "", /checksum/);
    assert.equal(fs.existsSync(f.app), false);
    assert.equal(f.calls.length, 0);
    broken = false;
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.equal(f.installer.status().error, undefined);
  } finally {
    await f.close();
  }
});

test("download errors, absent checksums and oversized payloads remain retryable without launching", async () => {
  for (const failure of ["network", "checksum", "size"] as const) {
    const f = fixture({
      fetch: async (input, init) => {
        if (failure === "network") throw new Error("network unavailable");
        if (failure === "checksum" && String(input).includes("/releases?"))
          return Response.json([
            {
              tag_name: "v2.9.1",
              assets: [{ name: "APX-2.9.1-linux-x64.AppImage", browser_download_url: "https://releases.example/app" }],
            },
          ]);
        if (failure === "size" && !String(input).includes("/releases?") && !String(input).endsWith(".sha256"))
          return new Response("x", { headers: { "content-length": String(2 ** 31) } });
        return f.fakeFetch(input, init);
      },
    });
    try {
      f.installer.start();
      assert.equal((await f.installer.wait()).phase, "failed");
      assert.equal(fs.existsSync(f.app), false);
      assert.equal(f.calls.length, 0);
    } finally {
      await f.close();
    }
  }
});

test("closing the core cancels an active download and leaves no installed app", async () => {
  let entered: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = fixture({
    fetch: async (_input, init) => {
      entered?.();
      return new Promise((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      );
    },
  });
  try {
    f.installer.start();
    await started;
    await f.installer.close();
    assert.equal(f.installer.status().phase, "failed");
    assert.equal(fs.existsSync(f.app), false);
  } finally {
    await f.close();
  }
});

test("a headless or SSH session never starts desktop installation", async () => {
  const f = fixture({ env: {} });
  try {
    assert.equal(f.installer.status().available, false);
    assert.throws(() => f.installer.start(), /graphical/);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
  assert.equal(hasDesktop("linux", { DISPLAY: ":1", SSH_CONNECTION: "forwarded" }), false);
  assert.equal(
    desktopDataDir("darwin", {}, "/home/user"),
    path.join("/home/user", "Library", "Application Support", "@apx", "desktop"),
  );
  assert.equal(
    desktopDataDir("linux", { XDG_CONFIG_HOME: "/custom" }, "/home/user"),
    path.join("/custom", "@apx", "desktop"),
  );
});

test("a disabled release feed never fetches a missing desktop", async () => {
  const f = fixture({ feed: "off" });
  try {
    assert.equal(f.installer.status().available, false);
    assert.throws(() => f.installer.start(), /graphical/);
    assert.equal(f.requests.length, 0);
  } finally {
    await f.close();
  }
});

test("macOS installs the verified zip into the user Applications folder, without a DMG drag step", async () => {
  const f = fixture({
    platform: "darwin",
    env: {},
    target: undefined,
    fetch: async (input) => {
      if (String(input).includes("/releases?"))
        return Response.json([
          {
            tag_name: "v2.9.1",
            assets: ["APX-2.9.1-mac-x64.zip", "APX-2.9.1-mac-x64.zip.sha256"].map((name) => ({
              name,
              browser_download_url: `https://releases.example/${name}`,
            })),
          },
        ]);
      return String(input).endsWith(".sha256")
        ? new Response(createHash("sha256").update("zip").digest("hex"))
        : new Response("zip");
    },
    run: async (command, args) => {
      f.calls.push({ command, args, env: {} });
      if (args[0] === "-x") {
        const executable = path.join(args[3] as string, "APX.app/Contents/MacOS/APX");
        fs.mkdirSync(path.dirname(executable), { recursive: true });
        fs.writeFileSync(executable, "app");
      } else if (command.endsWith("ditto")) fs.cpSync(args[0] as string, args[1] as string, { recursive: true });
    },
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.equal(fs.readFileSync(path.join(f.home, "Applications/APX.app/Contents/MacOS/APX"), "utf8"), "app");
    assert.deepEqual(f.calls.at(-1)?.args, ["-a", path.join(f.home, "Applications/APX.app")]);
    assert.ok(!f.calls.some((c) => c.command.includes("xattr")));
  } finally {
    await f.close();
  }
});

test("Windows waits for its installer before launching the installed executable", async () => {
  const f = fixture({
    platform: "win32",
    env: {},
    target: undefined,
    fetch: async (input) => {
      if (String(input).includes("/releases?"))
        return Response.json([
          {
            tag_name: "v2.9.1",
            assets: ["APX-2.9.1-win-x64.exe", "APX-2.9.1-win-x64.exe.sha256"].map((name) => ({
              name,
              browser_download_url: `https://releases.example/${name}`,
            })),
          },
        ]);
      return String(input).endsWith(".sha256")
        ? new Response(createHash("sha256").update("exe").digest("hex"))
        : new Response("exe");
    },
    run: async (command, args) => {
      f.calls.push({ command, args, env: {} });
      if (args.includes("/S")) {
        fs.mkdirSync(path.dirname(f.app));
        fs.writeFileSync(f.app, "installed");
      }
    },
  });
  try {
    f.installer.start();
    assert.equal((await f.installer.wait()).phase, "ready");
    assert.deepEqual(f.calls[0]?.args, ["/S"]);
    assert.equal(f.calls[1]?.command, f.app);
  } finally {
    await f.close();
  }
});
