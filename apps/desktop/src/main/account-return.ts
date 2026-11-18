/** Login finishes in the browser; this link only opens the account screen. */
export function accountReturn(value: string): true | undefined {
  const url = URL.parse(value);
  if (
    url?.protocol === "apx:" &&
    url.hostname === "account" &&
    url.pathname === "/signed-in" &&
    !url.username &&
    !url.password &&
    !url.port &&
    !url.hash &&
    !url.search
  )
    return true;
  return undefined;
}
