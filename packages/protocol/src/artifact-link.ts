/** Native handoffs name a public copy, never a download URL or a local destination. */
export function publicArtifactLink(value: string): string | undefined {
  const url = URL.parse(value);
  if (
    url?.protocol !== "apx:" ||
    url.hostname !== "artifact" ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !/^\/[0-9abcdefghjkmnpqrstvwxyz]{8}$/.test(url.pathname)
  )
    return undefined;
  return url.pathname.slice(1);
}
