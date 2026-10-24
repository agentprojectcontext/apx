import dns from "node:dns/promises";
import net from "node:net";
import os from "node:os";

type Interfaces = ReturnType<typeof os.networkInterfaces>;
const forbidden = new net.BlockList();
for (const cidr of [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]) {
  const [address, prefix] = cidr.split("/");
  forbidden.addSubnet(address ?? "", Number(prefix), "ipv4");
}
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  forbidden.addSubnet(address, prefix, "ipv6");
const globalV6 = new net.BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

/** Public Internet only, excluding every current host interface and directly connected network. */
export function vmAddressAllowed(address: string, interfaces: Interfaces = os.networkInterfaces()): boolean {
  const version = net.isIP(address);
  if (!version) return false;
  const family = version === 4 ? "ipv4" : "ipv6";
  if (forbidden.check(address, family) || (version === 6 && !globalV6.check(address, family))) return false;
  const local = new net.BlockList();
  for (const values of Object.values(interfaces))
    for (const value of values ?? []) {
      const kind = value.family === "IPv4" ? "ipv4" : "ipv6";
      local.addAddress(value.address, kind);
      if (value.cidr) local.addSubnet(value.address, Number(value.cidr.split("/")[1]), kind);
    }
  return !local.check(address, family);
}

export type EgressPolicy = {
  lookup(host: string): Promise<{ address: string; family: number }[]>;
  allowed(address: string): boolean;
};
export const vmEgressPolicy = (): EgressPolicy => ({
  lookup: (host) => dns.lookup(host, { all: true }),
  allowed: vmAddressAllowed,
});

export async function publicDestination(raw: string, policy: EgressPolicy) {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("only public HTTP(S) destinations");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await Promise.race([
        policy.lookup(host),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("destination lookup timed out")), 5000);
        }),
      ]).finally(() => clearTimeout(timer));
  if (!addresses.length || addresses.some(({ address }) => !policy.allowed(address)))
    throw new Error("destination is not public");
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  if (!selected) throw new Error("destination is unavailable");
  return { url, address: selected.address, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)) };
}
