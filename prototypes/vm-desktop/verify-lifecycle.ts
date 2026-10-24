import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ApxClient } from "../../packages/protocol/src/client.ts";

const runtime = path.resolve(process.argv[2] ?? "");
if (!path.basename(runtime).startsWith("apx-vm-lab-")) throw new Error("Use an isolated apx-vm-lab-* runtime");
const { url } = JSON.parse(fs.readFileSync(path.join(runtime, "running.json"), "utf8")) as { url: string };
const client = new ApxClient({ url: new URL(url).origin });
const thread = "home";
const wait = async (phase: string) => {
  const deadline = Date.now() + 120_000;
  while (true) {
    const state = await client.call("environments.status", {});
    if (state.phase === "error") throw new Error(state.error);
    if (state.phase === phase) return state;
    if (Date.now() > deadline) throw new Error(`VM did not reach ${phase}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};
await wait("running");
// The owner's own screen (0) is theirs from the start.
const guest = async (command: string) => {
  const result = await client.call("environments.command", { thread, command, screen: 0 });
  assert.equal(result.code, 0, result.output);
  return result.output.trim();
};
await guest("printf 'persistent VM file\\n' > lifecycle-check.txt");
await guest("xfconf-query -c xfwm4 -p /general/workspace_count -r || true");
const unset = await client.call("environments.command", {
  thread,
  screen: 0,
  command: "xfconf-query -c xfwm4 -p /general/workspace_count",
});
assert.notEqual(unset.code, 0, "fresh Xfce defaults must be absent for this regression check");
await guest("/usr/local/bin/apx-appearance light --reset");
for (const appearance of ["light", "dark"] as const) {
  await client.call("environments.appearance", { appearance });
  assert.equal(await guest("xfconf-query -c xsettings -p /Net/ThemeName"), `APX-Green-${appearance}`);
  assert.equal(
    await guest("xfconf-query -c xfce4-terminal -p /color-background"),
    appearance === "light" ? "#f4f7f2" : "#09140f",
  );
  const wallpaper = await guest(
    "xfconf-query -c xfce4-desktop -p /backdrop/screen0/monitorVNC-0/workspace0/last-image",
  );
  assert.match(wallpaper, appearance === "light" ? /apx-wallpaper-light-v1.png$/ : /apx-wallpaper-v1.png$/);
}
const original = await guest("xfconf-query -c xfce4-desktop -p /backdrop/screen0/monitorVNC-0/workspace0/last-image");
try {
  await guest(
    "cp ~/.local/share/apx-vm/apx-wallpaper-v1.png /home/apx-worker/work/custom-wallpaper.png; xfconf-query -c xfce4-desktop -p /backdrop/screen0/monitorVNC-0/workspace0/last-image -s /home/apx-worker/work/custom-wallpaper.png",
  );
  await client.call("environments.appearance", { thread, appearance: "light" });
  assert.equal(
    await guest("xfconf-query -c xfce4-desktop -p /backdrop/screen0/monitorVNC-0/workspace0/last-image"),
    "/home/apx-worker/work/custom-wallpaper.png",
  );
} finally {
  await guest(`xfconf-query -c xfce4-desktop -p /backdrop/screen0/monitorVNC-0/workspace0/last-image -s ${original}`);
}
await client.call("environments.stop", { thread });
await wait("stopped");
await assert.rejects(client.call("environments.command", { thread, command: "pwd" }), /stopped|not ready/);
await client.call("environments.enable", { thread, appearance: "light" });
await wait("running");
assert.equal(await guest("cat lifecycle-check.txt"), "persistent VM file");
assert.equal(await guest("xfconf-query -c xsettings -p /Net/ThemeName"), "APX-Green-light");
assert.equal(await guest("xfconf-query -c xfce4-terminal -p /color-background"), "#f4f7f2");
await client.call("environments.stop", { thread });
await wait("stopped");
process.stdout.write(
  "Verified: light/dark desktop, live terminal colors, custom wallpaper preservation, stop, blocked guest tools and persistent restart. VM left stopped.\n",
);
