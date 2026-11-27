// A stdio server that signs in through the owner's browser (mcp-remote and the like) says so on stderr, with the page
// to open: "Please authorize this client by visiting:\n https://…". Seeing it is how APX knows the server waits on them.

import type { Stream } from "node:stream";
import { stripVTControlCharacters } from "node:util";

/** The sign-in words, then a URL on the same or the next line, ended (a URL cut mid-chunk is not taken). */
const ASKS =
  /(?:authori[sz]e[^\n]*(?:visit(?:ing)?|at|open)|(?:sign[ -]?in|log[ -]?in)\s+(?:at|via|by visiting)|open\s+this\s+url\s+to\s+(?:sign[ -]?in|log[ -]?in))\s*:?\s*(https?:\/\/[^\s"'<>]+)\s/i;
const KEEP = 8_000;

/** The sign-in page a server's output asks the owner to open, if it does. */
export function signInUrl(text: string): string | undefined {
  return ASKS.exec(stripVTControlCharacters(text))?.[1];
}

/** Calls `onAsk` once, with the page, when a server's stderr asks the owner to sign in. */
export function watchSignIn(stream: Stream | null | undefined, onAsk: (url: string) => void): void {
  if (!stream) return;
  let seen = "";
  let asked = false;
  stream.on("data", (chunk: Buffer | string) => {
    if (asked) return;
    seen = (seen + chunk.toString()).slice(-KEEP);
    const url = signInUrl(seen);
    if (!url) return;
    asked = true;
    onAsk(url);
  });
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Where to open, on this machine, the page a sign-in ended on in a browser elsewhere: only the exact return address
 * the sign-in page names (this machine, same port and path) carrying its own `state`.
 */
export function returnAddress(page: string, ended: string): URL | undefined {
  let asked: URL;
  let back: URL;
  let got: URL;
  try {
    asked = new URL(page);
    back = new URL(asked.searchParams.get("redirect_uri") ?? "");
    got = new URL(ended.trim());
  } catch {
    return undefined;
  }
  if (back.protocol !== "http:" || !LOOPBACK.has(back.hostname)) return undefined;
  if (got.protocol !== "http:" || !LOOPBACK.has(got.hostname)) return undefined;
  if (got.port !== back.port || got.pathname !== back.pathname) return undefined;
  const state = asked.searchParams.get("state");
  if (!state || got.searchParams.get("state") !== state) return undefined;
  if (!got.searchParams.has("code") && !got.searchParams.has("error")) return undefined;
  return new URL(`${back.origin}${got.pathname}${got.search}`);
}

/** Opens that return address here, where the server waits for it; whether it took it. */
export async function finishSignIn(at: URL): Promise<boolean> {
  try {
    const res = await fetch(at, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel();
    return res.status < 400;
  } catch {
    return false;
  }
}
