import { ApxError } from "./client.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "0.0.0.0"]);

/** A host on this computer itself. */
export function loopbackHost(hostname: string): boolean {
  return /^(localhost|([\w-]+\.)+localhost|127(\.\d{1,3}){3}|\[::1\])$/i.test(hostname);
}

/** A page served by this computer, other than APX's own ports. */
export function servedHere(url: string, blockedPorts: ReadonlySet<string>): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return loopbackHost(u.hostname) && !blockedPorts.has(u.port || (u.protocol === "https:" ? "443" : "80"));
}

/** Keep driven tabs out of APX itself, credentials in URLs and link-local or cloud-metadata addresses. */
export function assertNavigable(url: string, blockedPorts: ReadonlySet<string>): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ApxError({ code: "bad_request", message: `not a URL: ${url}` });
  }
  if (u.protocol !== "http:" && u.protocol !== "https:")
    throw new ApxError({ code: "bad_request", message: `navigation blocked: only http(s), got ${u.protocol}` });
  if (u.username || u.password)
    throw new ApxError({ code: "bad_request", message: "navigation blocked: credentials in URL" });
  if (LOOPBACK.has(u.hostname) && blockedPorts.has(u.port || "80"))
    throw new ApxError({ code: "bad_request", message: "navigation blocked: that is APX itself" });
  if (/^169\.254\./.test(u.hostname) || u.hostname === "metadata.google.internal")
    throw new ApxError({ code: "bad_request", message: "navigation blocked: link-local/metadata address" });
}
