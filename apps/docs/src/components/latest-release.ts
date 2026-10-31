// Download links already point at the release the site was built with (src/data/latest-release.ts). This only moves
// them to a newer v2 release published since; it never puts a link back on the releases page. One request per page.
type Release = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string; browser_download_url: string }[];
};

let newest: Promise<Release | null> | undefined;

export function fillLatest(links: Iterable<HTMLAnchorElement>): Promise<void> {
  newest ??= fetch("https://api.github.com/repos/agentprojectcontext/apx/releases?per_page=20")
    .then((r) => (r.ok ? (r.json() as Promise<Release[]>) : []))
    .then((list) => list.find((r) => !r.draft && !r.prerelease && /^v2\.\d+\.\d+$/.test(r.tag_name)) ?? null)
    .catch(() => null);
  return newest.then((release) => {
    if (!release) return;
    for (const link of links) {
      if (link.dataset.release === release.tag_name) continue;
      const asset = release.assets.find((a) => a.name.endsWith(link.dataset.file ?? "\0"));
      if (asset) link.href = asset.browser_download_url;
    }
  });
}
