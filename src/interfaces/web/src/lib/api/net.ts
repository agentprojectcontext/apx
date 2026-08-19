import { http } from "../http";
import { rememberEndpoints, type Endpoint } from "../net";

export interface TailscaleInfo {
  installed: boolean;
  running: boolean;
  /** Tailscale's own word for what it is doing: Running, Stopped, NeedsLogin. */
  state: string | null;
  ipv4: string | null;
  hostname: string | null;
  dnsName: string | null;
  serving: boolean;
  serve_url: string | null;
  serve_error: string | null;
  error: string | null;
}

export interface NetEndpoints {
  port: number;
  bind: string;
  shared: boolean;
  endpoints: Endpoint[];
  tailscale: TailscaleInfo;
}

export const Net = {
  /** Every address this daemon answers at. Reading it also arms the failover:
   *  the list is cached so a client that loses its address can try the rest. */
  async endpoints(): Promise<NetEndpoints> {
    const out = await http.get<NetEndpoints>("/api/net/endpoints");
    rememberEndpoints(out.endpoints || []);
    return out;
  },
  serve: () =>
    http.post<{ ok: boolean; serving: boolean; url: string | null; error?: string }>(
      "/api/net/tailscale/serve",
    ),
  unserve: () =>
    http.del<{ ok: boolean; serving: boolean; url: string | null; error?: string }>(
      "/api/net/tailscale/serve",
    ),
};

export type { Endpoint };
