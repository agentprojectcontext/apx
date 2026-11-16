// `npm run android:release`: the Android release build with a JDK Gradle accepts (17 or 21). A newer default Java
// fails in jlink while compiling native modules, so this picks a supported one instead of the system default.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPORTED = [21, 17];

/** The major version of the Java at `home`, or undefined when there is none. */
function majorOf(home) {
  const java = resolve(home, "bin/java");
  if (!existsSync(java)) return undefined;
  const out = spawnSync(java, ["-version"], { encoding: "utf8" });
  const match = /version "(\d+)/.exec(`${out.stderr}${out.stdout}`);
  return match ? Number(match[1]) : undefined;
}

function candidates() {
  const found = [];
  if (process.env.JAVA_HOME) found.push(process.env.JAVA_HOME);
  for (const v of SUPPORTED) {
    if (process.platform === "darwin") {
      try {
        found.push(execFileSync("/usr/libexec/java_home", ["-v", String(v)], { encoding: "utf8" }).trim());
      } catch {}
      for (const prefix of ["/opt/homebrew", "/usr/local"]) {
        found.push(`${prefix}/opt/openjdk@${v}/libexec/openjdk.jdk/Contents/Home`);
      }
    }
    if (existsSync("/usr/lib/jvm")) {
      for (const dir of readdirSync("/usr/lib/jvm")) if (dir.includes(`-${v}`)) found.push(`/usr/lib/jvm/${dir}`);
    }
  }
  return found;
}

const javaHome = candidates().find((home) => SUPPORTED.includes(majorOf(home)));
if (!javaHome) {
  console.error(
    "The Android build needs JDK 17 or 21 (a newer default Java fails). Install one (macOS: brew install openjdk@17) or set JAVA_HOME to it.",
  );
  process.exit(1);
}
console.error(`Java ${majorOf(javaHome)}: ${javaHome}`);

const env = { ...process.env, JAVA_HOME: javaHome };
const run = (command, args, cwd) => {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (!existsSync(resolve(mobile, "android")))
  run("npx", ["expo", "prebuild", "--platform", "android", "--no-install"], mobile);
run("./gradlew", ["assembleRelease"], resolve(mobile, "android"));
console.error(`Built: ${resolve(mobile, "android/app/build/outputs/apk/release/app-release.apk")}`);
