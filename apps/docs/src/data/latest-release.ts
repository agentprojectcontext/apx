// The newest v2 release's downloads, looked up once per build so every download link in the HTML points straight at
// its file. Visitors' browsers never need GitHub's API for that (it allows 60 calls an hour per address without a
// token). If the lookup fails the links keep the releases page; the build never fails over it.
type Asset = { name: string; browser_download_url: string };
type Release = { tag_name: string; draft: boolean; prerelease: boolean; assets: Asset[] };

export const releasesPage = "https://github.com/agentprojectcontext/apx/releases?q=v2&expanded=true";

/** The ends of the asset names the site links to, one per download. */
export const downloadFiles = [
  "-mac-arm64.dmg",
  "-mac-x64.dmg",
  "-win-x64.exe",
  "-linux-x86_64.AppImage",
  "-linux-arm64.AppImage",
  "-android.apk",
] as const;

async function lookup(): Promise<{ tag: string; assets: Asset[] } | null> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    // A list, not /releases/latest: v1 shares the repository, so only v2 tags count.
    const response = await fetch("https://api.github.com/repos/agentprojectcontext/apx/releases?per_page=20", {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const release = ((await response.json()) as Release[]).find(
      (r) => !r.draft && !r.prerelease && /^v2\.\d+\.\d+$/.test(r.tag_name),
    );
    if (!release) throw new Error("no v2 release in the latest 20");
    return { tag: release.tag_name, assets: release.assets };
  } catch (error) {
    console.warn(`[latest-release] download links keep the releases page: ${(error as Error).message}`);
    return null;
  }
}

const latest = await lookup();

/** The tag the links were built for, or "" when they point at the releases page. */
export const builtRelease = latest?.tag ?? "";

/** The direct URL of the asset ending in `file`, or the releases page when it is not known. */
export function downloadHref(file: string): string {
  return latest?.assets.find((a) => a.name.endsWith(file))?.browser_download_url ?? releasesPage;
}
