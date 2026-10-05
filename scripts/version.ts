// The version a build shows. Releases set package.json from their tag; a checkout's package.json is a placeholder,
// so its version comes from git: the last tag, plus the commits past it (`2.1.2-dev.40+d85585f`).
import { execFileSync } from "node:child_process";

export function buildVersion(packageVersion: string, cwd: string): string {
  let described: string;
  try {
    described = execFileSync("git", ["describe", "--tags", "--long", "--match", "v[0-9]*"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return packageVersion;
  }
  const m = /^v(.+)-(\d+)-g([0-9a-f]+)$/.exec(described);
  if (!m) return packageVersion;
  const [, tag = packageVersion, ahead, sha] = m;
  return ahead === "0" ? tag : `${tag}-dev.${ahead}+${sha}`;
}
