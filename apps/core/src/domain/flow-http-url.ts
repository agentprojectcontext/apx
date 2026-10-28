// What an HTTP step's fixed address may be, checked when it is drawn. The request checks again after resolving the
// name and on the socket it connects (flow-http.ts): a name that is public today can point inside tomorrow.
import net from "node:net";
import { vmAddressAllowed } from "../environments/egress-policy.ts";

/** A literal address or a name that is this computer: never a destination. */
export function flowHttpUrlProblem(raw: string): "invalid" | "private" | "secret" | undefined {
  if (raw.includes("secret://")) return "secret";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid";
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname) return "invalid";
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (net.isIP(host)) return vmAddressAllowed(host) ? undefined : "private";
  if (host === "localhost" || host.endsWith(".localhost") || !host.includes(".")) return "private";
  return undefined;
}
