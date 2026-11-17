export type AccountReturn = { code: string; state: string };

/** Deep links carry only a one-use code; the matching PKCE verifier never leaves the selected core. */
export function accountReturn(value: string): AccountReturn | undefined {
  const url = URL.parse(value);
  if (
    url?.protocol !== "apx:" ||
    url.hostname !== "account" ||
    url.pathname !== "/callback" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    return undefined;
  if ([...url.searchParams.keys()].some((key) => key !== "code" && key !== "state")) return undefined;
  if (url.searchParams.getAll("code").length !== 1 || url.searchParams.getAll("state").length !== 1) return undefined;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || code.length > 2000 || state.length > 2000) return undefined;
  return { code, state };
}
