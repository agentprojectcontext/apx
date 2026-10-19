import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  adoptBundleApp,
  appRoot,
  bundleAppOf,
  bundleRun,
  coreMain,
  launchdPlist,
  serviceEnv,
  serviceNames,
  serviceOwnsHome,
  systemdUnit,
  windowsProcessPattern,
  windowsRunCommand,
} from "./service-files.ts";

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
  assert.match(systemdUnit({ ...spec, cwd: "/srv/my apx 100%" }), /^WorkingDirectory=\/srv\/my apx 100%%$/m);
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
  assert.match(
    windowsRunCommand({ ...o, electron: false, env: { APX_RELEASES: "http://192.168.0.10:7480" } }),
    /^cmd \/d \/c "set APX_RELEASES=http:\/\/192.168.0.10:7480&& "C:\\Node\\node.exe" .* service run --home .*"$/,
  );
});

test("a bundle install runs through current, and its terminal finds the install it lives in", () => {
  const app = path.resolve("/home/u/.apx/v2/app");
  const b = bundleRun(app, false);
  assert.equal(b.node, path.join(app, "current", "node", "bin", "node"));
  assert.equal(b.core, path.join(app, "current", "apps", "core", "src", "main.ts"));
  assert.equal(bundleRun("/home/u/.apx/v2/app", true).node, path.join(app, "current", "node", "node.exe"));
  assert.equal(
    bundleAppOf("/home/u/.apx/v2/app/versions/2.1.0/apps/terminal/src"),
    path.resolve("/home/u/.apx/v2/app"),
  );
  assert.equal(bundleAppOf("/home/u/work/apx-v2/apps/terminal/src"), undefined);
  assert.ok(serviceEnv({ APX_APP: "/home/u/.apx/v2/app" }).APX_APP);
});

test("a checkout leaves APX_APP unset; a bundle's terminal sets it, and an APX_APP already given wins", () => {
  const checkout: NodeJS.ProcessEnv = {};
  adoptBundleApp(checkout, "/home/u/work/apx-v2/apps/terminal/src");
  assert.ok(!("APX_APP" in checkout));
  assert.equal(serviceEnv(checkout).APX_APP, undefined);
  const bundle: NodeJS.ProcessEnv = {};
  adoptBundleApp(bundle, "/home/u/.apx/v2/app/versions/2.1.0/apps/terminal/src");
  assert.equal(bundle.APX_APP, path.resolve("/home/u/.apx/v2/app"));
  const given: NodeJS.ProcessEnv = { APX_APP: "/srv/apx" };
  adoptBundleApp(given, "/home/u/.apx/v2/app/versions/2.1.0/apps/terminal/src");
  assert.equal(given.APX_APP, "/srv/apx");
});

test("service identities isolate custom homes and preserve default names", () => {
  const base = path.resolve("/data/apx");
  const normal = serviceNames(base, base);
  assert.deepEqual(normal, { systemd: "apx.service", launchd: "dev.apx.core", windows: "APXCore" });
  const other = serviceNames(path.join(base, "other"), base);
  assert.notDeepEqual(other, normal);
  assert.deepEqual(other, serviceNames(path.join(base, "other", "."), base));
});

test("existing service entries cannot authorize control of another home", () => {
  const home = "/data/apx 100%";
  assert.equal(serviceOwnsHome(systemdUnit(spec), "linux", home), true);
  assert.equal(serviceOwnsHome(systemdUnit(spec), "linux", "/data/other"), false);
  assert.equal(serviceOwnsHome(launchdPlist(spec), "darwin", home), true);
  assert.equal(serviceOwnsHome(launchdPlist(spec), "darwin", "/data/other"), false);
  assert.match(launchdPlist({ ...spec, label: "dev.apx.core-custom" }), /<string>dev.apx.core-custom<\/string>/);
  const command = windowsRunCommand({ node: "node.exe", terminal: "main.ts", home, electron: false });
  assert.equal(serviceOwnsHome(command, "win32", home), true);
  assert.equal(serviceOwnsHome(command, "win32", "/data/other"), false);
});

test("Windows process authority matches complete arguments with OS quoting variations", () => {
  const args = [
    "C:\\node\\node.exe",
    "--disable-warning=ExperimentalWarning",
    "C:\\apx\\main.ts",
    "service",
    "run",
    "--home",
    "C:\\data\\apx",
  ];
  const matches = new RegExp(windowsProcessPattern(args), "i");
  assert.ok(matches.test(args.join(" ")));
  assert.ok(matches.test(args.map((arg) => `"${arg}"`).join(" ")));
  assert.ok(!matches.test(`${args.join(" ")} --extra`));
  assert.ok(!matches.test(`echo ${args.join(" ")}`));
  assert.ok(!matches.test(args.join(" ").replace("C:\\data\\apx", "C:\\data\\apx-other")));
  const spaced = ["C:\\Program Files\\node.exe", "main.ts"];
  assert.ok(new RegExp(windowsProcessPattern(spaced), "i").test('"C:\\Program Files\\node.exe" main.ts'));
  assert.ok(!new RegExp(windowsProcessPattern(spaced), "i").test(spaced.join(" ")));
});
