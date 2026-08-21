import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const android = (...parts) => path.join(ROOT, "src", "interfaces", "android", "app", "src", "main", ...parts);
const read = (...parts) => fs.readFileSync(android(...parts), "utf8");

test("Android branding uses the canonical APX logo for splash and launcher", () => {
  const sourceLogo = fs.readFileSync(path.join(ROOT, "assets", "logo.png"));
  const bundledLogo = fs.readFileSync(android("res", "drawable-nodpi", "apx_logo.png"));
  const manifest = read("AndroidManifest.xml");
  const activity = read("java", "dev", "agentprojectcontext", "apx", "MainActivity.java");
  const splash = read("res", "values-v31", "styles.xml");
  const launcher = read("res", "mipmap-anydpi-v26", "ic_launcher.xml");

  assert.deepEqual(bundledLogo, sourceLogo);
  assert.match(manifest, /android:icon="@mipmap\/ic_launcher"/);
  assert.match(manifest, /android:roundIcon="@mipmap\/ic_launcher_round"/);
  assert.match(activity, /setImageResource\(R\.drawable\.apx_logo\)/);
  assert.match(splash, /android:windowSplashScreenAnimatedIcon/);
  assert.match(launcher, /@drawable\/ic_apx_launcher_foreground/);
});
