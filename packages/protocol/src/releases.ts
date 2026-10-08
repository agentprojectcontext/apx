// Where an installed APX learns that a newer one is out: the GitHub Releases of a public repo. Shared by the core (a
// server install updates itself) and the desktop app (it updates the app, which carries its own core).

/**
 * owner/repo whose Releases hold the installers and the daemon bundles. APX_RELEASES overrides it (an owner/repo, or
 * the base URL of a GitHub-shaped API such as a local test feed); "off" disables.
 */
export const RELEASE_FEED = "agentprojectcontext/apx";
export const RELEASE_CHECK_EVERY_MS = 6 * 3600_000;

export type ReleaseAsset = { name: string; url: string };
export type Release = { version: string; notes: string[]; assets: ReleaseAsset[] };

/** The operating system and processor as release file names spell them (electron-builder's ${os}, Node's arch). */
export type Platform = { os: "linux" | "mac" | "win"; arch: "x64" | "arm64" };

export function platformOf(platform: string, arch: string): Platform | undefined {
  const os = platform === "linux" ? "linux" : platform === "darwin" ? "mac" : platform === "win32" ? "win" : undefined;
  return os && (arch === "x64" || arch === "arm64") ? { os, arch } : undefined;
}

/** A build target as `<os>-<arch>` (APX_TARGET=linux-x64), or this machine when unset. */
export function targetOf(spec: string | undefined, platform: string, arch: string): Platform | undefined {
  if (!spec) return platformOf(platform, arch);
  const [os, cpu] = spec.split("-");
  const node = os === "mac" ? "darwin" : os === "win" ? "win32" : os;
  return platformOf(node ?? "", cpu ?? "");
}

/** Node's name for a platform's operating system (what npm --os and the Node downloads say). */
export const nodeOs = (p: Platform) => (p.os === "mac" ? "darwin" : p.os === "win" ? "win32" : "linux");

/** The daemon on its own (core, terminal, panel and the Node that runs them), as install.sh/ps1 and updates fetch it. */
export const coreBundleName = (version: string, p: Platform) => `apx-core-${version}-${p.os}-${p.arch}.tar.gz`;

/** The desktop app's installer for this platform, as electron-builder names it (it says x86_64 for an x64 AppImage). */
export function desktopAssetFor(
  assets: ReleaseAsset[],
  version: string,
  p: Platform,
  kind: "installer" | "zip" = "installer",
): ReleaseAsset | undefined {
  const ext = kind === "zip" ? ".zip" : p.os === "linux" ? ".AppImage" : p.os === "mac" ? ".dmg" : ".exe";
  const arches = p.arch === "x64" ? ["x64", "x86_64", "amd64"] : ["arm64", "aarch64"];
  return assets.find((a) => arches.some((arch) => a.name === `APX-${version}-${p.os}-${arch}${ext}`));
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Plain x.y.z only (a pre-release or a dev build compares by its x.y.z). Negative when a is older than b. */
export function compareVersions(a: string, b: string): number {
  const pa = SEMVER.exec(a.replace(/[-+].*$/, ""));
  const pb = SEMVER.exec(b.replace(/[-+].*$/, ""));
  if (!pa || !pb) return 0;
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d) return d;
  }
  return 0;
}

type GithubRelease = {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  body?: unknown;
  assets?: Array<{ name?: unknown; browser_download_url?: unknown }>;
};

/** What the release body says, as short lines (its bullets, without the markdown). */
function notesOf(body: unknown, max = 8): string[] {
  if (typeof body !== "string") return [];
  return body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[-*] /.test(l))
    .map((l) =>
      l
        .slice(2)
        .replace(/ by @\S+ in \S+$/, "")
        .replace(/\*\*|`/g, "")
        .trim(),
    )
    .filter(Boolean)
    .slice(0, max);
}

/**
 * The published releases newer than `current`, newest first, from the GitHub API's list. Drafts, pre-releases and
 * tags that are not plain vX.Y.Z (v1's own tags are older, so they never count) are left out.
 */
export function newerReleases(list: unknown, current: string): Release[] {
  if (!Array.isArray(list)) return [];
  const out: Release[] = [];
  for (const r of list as GithubRelease[]) {
    if (r.draft === true || r.prerelease === true || typeof r.tag_name !== "string") continue;
    if (!SEMVER.test(r.tag_name) || compareVersions(r.tag_name, current) <= 0) continue;
    const assets = (r.assets ?? []).flatMap((a) =>
      typeof a.name === "string" && typeof a.browser_download_url === "string"
        ? [{ name: a.name, url: a.browser_download_url }]
        : [],
    );
    out.push({ version: r.tag_name.slice(1), notes: notesOf(r.body), assets });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** Asks GitHub for the feed's recent releases (no token: 60 requests an hour per address is plenty). */
export async function fetchReleases(feed: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  const base = /^https?:\/\//.test(feed) ? feed.replace(/\/+$/, "") : `https://api.github.com/repos/${feed}`;
  const r = await fetchImpl(`${base}/releases?per_page=30`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "apx-updates" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok) throw new Error(`release feed ${feed}: HTTP ${r.status}`);
  return r.json();
}

/** The hex digest a `<asset>.sha256` file holds (`<hex>  <name>`, as sha256sum writes it). */
export function parseSha256(text: string): string | undefined {
  return /^[0-9a-f]{64}\b/i.exec(text.trim())?.[0].toLowerCase();
}

/**
 * A daemon installed from a bundle (install.sh/ps1) lives in APX_APP: `versions/<version>/` holds each bundle as
 * unpacked, and `current` links the one that runs. Paths inside a bundle, as segments to join.
 */
export const BUNDLE = {
  current: "current",
  versions: "versions",
  node: (win: boolean) => (win ? ["node", "node.exe"] : ["node", "bin", "node"]),
  core: ["apps", "core", "src", "main.ts"],
  terminal: ["apps", "terminal", "src", "main.ts"],
} as const;
