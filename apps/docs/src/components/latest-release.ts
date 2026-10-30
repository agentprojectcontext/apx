// Download links point at the releases page until the latest release answers; then each link whose `data-file`
// matches the end of an asset's name gets that asset's direct URL. One request per page, shared by every caller.
type Release = { assets?: { name: string; browser_download_url: string }[] } | null;

let latest: Promise<Release> | undefined;

export function fillLatest(links: Iterable<HTMLAnchorElement>): Promise<void> {
  latest ??= fetch("https://api.github.com/repos/agentprojectcontext/apx/releases/latest")
    .then((r) => (r.ok ? (r.json() as Promise<Release>) : null))
    .catch(() => null);
  return latest.then((release) => {
    for (const link of links) {
      const asset = release?.assets?.find((a) => a.name.endsWith(link.dataset.file ?? "\0"));
      if (asset) link.href = asset.browser_download_url;
    }
  });
}
