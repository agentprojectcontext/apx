import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { appRoot, coreMain, launchdPlist, serviceEnv, systemdUnit, windowsRunCommand } from "./service-files.ts";

const spec = {
  node: "/opt/node 24/bin/node",
  main: "/srv/apx/apps/core/src/main.ts",
  cwd: "/srv/apx",
  env: { APX_SUPERVISED: "1", APX_HOME: "/data/apx 100%" },
  log: "/data/apx/logs/core.log",
};

test("the core entry is found beside the terminal", () => {
  assert.ok(fs.existsSync(coreMain()));
  assert.ok(fs.existsSync(path.join(appRoot(coreMain()), "apps", "terminal")));
});

test("the service environment keeps only what the core needs and always marks it supervised", () => {
  assert.deepEqual(serviceEnv({ APX_HOME: "/h", PATH: "/usr/bin", SECRET: "x", ELECTRON_RUN_AS_NODE: "" }), {
    APX_SUPERVISED: "1",
    APX_HOME: "/h",
    PATH: "/usr/bin",
  });
});

test("the systemd unit restarts the core always and quotes paths with spaces and percents", () => {
  const unit = systemdUnit(spec);
  assert.match(
    unit,
    /^ExecStart="\/opt\/node 24\/bin\/node" "--disable-warning=ExperimentalWarning" "\/srv\/apx\/apps\/core\/src\/main.ts"$/m,
  );
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^Environment="APX_HOME=\/data\/apx 100%%"$/m);
  assert.match(unit, /^WantedBy=default.target$/m);
});

test("the launchd agent keeps the core alive, starts at login and logs to the home", () => {
  const plist = launchdPlist(spec);
  assert.match(plist, /<key>Label<\/key>\n\s*<string>dev.apx.core<\/string>/);
  assert.match(plist, /<key>KeepAlive<\/key>\n\s*<true\/>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n\s*<true\/>/);
  assert.match(plist, /<key>StandardErrorPath<\/key>\n\s*<string>\/data\/apx\/logs\/core.log<\/string>/);
  assert.match(
    plist,
    /<string>\/opt\/node 24\/bin\/node<\/string>\n\s*<string>--disable-warning=ExperimentalWarning<\/string>/,
  );
  assert.ok(!launchdPlist({ ...spec, env: { A: "<&>" } }).includes("<&>"));
});

test("the Windows login entry runs the terminal's supervisor, through cmd only for Electron", () => {
  const o = {
    node: "C:\\Node\\node.exe",
    terminal: "C:\\apx\\apps\\terminal\\src\\main.ts",
    home: "C:\\Users\\u\\.apx\\v2",
  };
  assert.equal(
    windowsRunCommand({ ...o, electron: false }),
    '"C:\\Node\\node.exe" --disable-warning=ExperimentalWarning "C:\\apx\\apps\\terminal\\src\\main.ts" service run --home "C:\\Users\\u\\.apx\\v2"',
  );
  assert.match(windowsRunCommand({ ...o, electron: true }), /^cmd \/d \/c "set ELECTRON_RUN_AS_NODE=1&& "C:/);
});
