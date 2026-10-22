// A stdio server that signs in through the owner's browser (mcp-remote and the like) says so on stderr, with the page
// to open: "Please authorize this client by visiting:\n https://…". Seeing it is how APX knows the server waits on them.

import type { Stream } from "node:stream";
import { stripVTControlCharacters } from "node:util";

/** The sign-in words, then a URL on the same or the next line, ended (a URL cut mid-chunk is not taken). */
const ASKS = /(?:authori[sz]e|sign[ -]?in|log[ -]?in)[^\n]*\n?[^\n]*?(https?:\/\/[^\s"'<>]+)\s/i;
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
