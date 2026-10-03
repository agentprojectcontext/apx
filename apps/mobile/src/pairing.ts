// What the panel's QR carries (apx://pair?c=<code>&u=<url>…), and finding which of the core's addresses this phone
// can reach. Pure: no React Native here, so it runs under node:test.

export type PairingLink = { code: string; urls: string[] };

export function parsePairingLink(text: string): PairingLink | undefined {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "apx:" || url.hostname !== "pair") return undefined;
  const code = url.searchParams.get("c")?.trim() ?? "";
  const urls = url.searchParams.getAll("u").filter((u) => /^https?:\/\/[^\s]+$/.test(u));
  return code ? { code, urls } : undefined;
}

/** The first address that answers /health, tried in the order the core gave them; none when none answers. */
export async function firstReachable(
  urls: readonly string[],
  probe: (url: string) => Promise<boolean> = health,
): Promise<string | undefined> {
  const tries = urls.map(async (u) => ((await probe(u)) ? u : Promise.reject(new Error("unreachable"))));
  try {
    return await Promise.any(tries);
  } catch {
    return undefined;
  }
}

async function health(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}
