// Route-scoped public bearer credentials. Only secret references live in SQLite or idempotent RPC replies.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PublicEndpointPath as Path } from "@apx/protocol";
import { z } from "zod";
import type { Store } from "./domain/store.ts";
import { badRequest } from "./errors.ts";
import type { Secrets } from "./secrets.ts";
import type { PublicRoute, PublicRoutes } from "./transport/hooks.ts";

export type PublicEndpoint = { path: string; label: string };
const Saved = z
  .array(
    z
      .object({
        path: Path,
        secret_ref: z.string().regex(/^secret:\/\/public-token-[a-f0-9]{32}$/),
        rotated_at: z.string(),
      })
      .strict(),
  )
  .max(1000);
const KEY = "public-route-credentials";
/** What a key may be: APX's own (`apxp_` and 64 hex) or one the owner chose (DECISIONS.md#d-182). */
export const PUBLIC_TOKEN = /^[A-Za-z0-9._~-]{24,200}$/;
const digest = (value: string) => createHash("sha256").update(value).digest();
const deliveryHeaders = (headers: Record<string, string>) =>
  Object.fromEntries(Object.entries(headers).filter(([name]) => name === "content-type" || name === "idempotency-key"));

export function createPublicCredentials(deps: { store: Store; secrets: Secrets; endpoints(): PublicEndpoint[] }) {
  const read = () => {
    try {
      const parsed = Saved.safeParse(JSON.parse(deps.store.settings.get(KEY) ?? "[]"));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  };
  const cleanupKey = "public-route-credential-cleanup";
  const pendingSchema = z.array(z.string().regex(/^secret:\/\/public-token-[a-f0-9]{32}$/)).max(1000);
  const pending = () => pendingSchema.parse(JSON.parse(deps.store.settings.get(cleanupKey) ?? "[]"));
  const savePending = (refs: string[]) => deps.store.settings.set(cleanupKey, JSON.stringify(refs));
  const cleanup = () => {
    try {
      const active = new Set(read().map((entry) => entry.secret_ref));
      const remaining = pending().filter((ref) => {
        if (active.has(ref)) return true;
        try {
          deps.secrets.set(ref.slice(9), null);
          return false;
        } catch {
          return true;
        }
      });
      savePending(remaining);
    } catch {
      // Cleanup must not hide an already committed rotation's new credential from its caller.
    }
  };
  cleanup();
  const known = (pathname: string) =>
    Path.safeParse(pathname).success && deps.endpoints().some((e) => e.path === pathname);
  const api = {
    list() {
      const saved = read();
      return deps
        .endpoints()
        .filter((e) => Path.safeParse(e.path).success)
        .map((e) => {
          const credential = saved.find((s) => s.path === e.path);
          return {
            ...e,
            enabled: Boolean(credential && deps.secrets.has(credential.secret_ref)),
            ...(credential ? { rotated_at: credential.rotated_at } : {}),
          };
        });
    },
    rotate(pathname: string) {
      if (!known(pathname)) throw badRequest("only a registered public endpoint can receive a token");
      return api.issue(pathname);
    },
    /**
     * A new key for an address whether or not it is a route now (a Flow still off), APX's or `value`; the old one
     * stops at once. Callers check the address is one the owner may key.
     */
    issue(pathname: string, value?: string) {
      if (!Path.safeParse(pathname).success) throw badRequest("invalid public endpoint path");
      if (value !== undefined && !PUBLIC_TOKEN.test(value)) throw badRequest("invalid token");
      cleanup();
      const saved = read();
      const before = saved.find((s) => s.path === pathname);
      const queued = pending();
      if (queued.length >= 1000) throw badRequest("public credential cleanup is full; restore secret storage first");
      if (!before && saved.length >= 1000) throw badRequest("too many public endpoints");
      const name = `public-token-${randomBytes(16).toString("hex")}`;
      const entry = { path: pathname, secret_ref: `secret://${name}`, rotated_at: new Date().toISOString() };
      // Journal before touching the external secret store: an interrupted creation is never untracked.
      savePending([...queued, entry.secret_ref]);
      try {
        deps.secrets.set(name, value ?? `apxp_${randomBytes(32).toString("hex")}`);
        deps.store.tx(() => {
          deps.store.settings.set(KEY, JSON.stringify([...saved.filter((s) => s.path !== pathname), entry]));
          savePending(before ? [...queued, before.secret_ref] : queued);
        });
      } catch (err) {
        cleanup();
        throw err;
      }
      cleanup();
      return entry;
    },
    /** The address's key and when it was made, for the owner's own screen; null when it has none. */
    reveal(pathname: string): { token: string | null; rotated_at: string | null } {
      const entry = read().find((s) => s.path === pathname);
      return {
        token: (entry && deps.secrets.resolve(entry.secret_ref)) ?? null,
        rotated_at: entry?.rotated_at ?? null,
      };
    },
    revoke(pathname: string) {
      if (!Path.safeParse(pathname).success) throw badRequest("invalid public endpoint path");
      const saved = read();
      // Keep references until deletion succeeds so a retry can clean up after a storage failure.
      for (const old of saved.filter((s) => s.path === pathname)) deps.secrets.set(old.secret_ref.slice(9), null);
      deps.store.settings.set(KEY, JSON.stringify(saved.filter((s) => s.path !== pathname)));
      return { revoked: true };
    },
    /**
     * Whether an address has a key, registered as a route now or not (a Flow turned off keeps its key). An entry whose
     * secret can't be read now (a locked keyring) still counts: `verify` then refuses rather than letting anyone in.
     */
    has(pathname: string): boolean {
      return read().some((s) => s.path === pathname);
    },
    /** These headers carry the address's own key; false when it has none. */
    verify(pathname: string, headers: Record<string, string>): boolean {
      const supplied = headers.authorization;
      if (!supplied?.startsWith("Bearer ") || !PUBLIC_TOKEN.test(supplied.slice(7))) return false;
      const ref = read().find((s) => s.path === pathname)?.secret_ref;
      const expected = deps.secrets.resolve(ref);
      return Boolean(expected && timingSafeEqual(digest(supplied.slice(7)), digest(expected)));
    },
    authorize(pathname: string, headers: Record<string, string>) {
      return known(pathname) && api.verify(pathname, headers);
    },
    /**
     * An address renamed: its key goes with it, so the caller only changes the URL; a key left at the new address by a
     * Flow that had it before is revoked.
     */
    move(from: string, to: string) {
      if (!Path.safeParse(from).success || !Path.safeParse(to).success)
        throw badRequest("invalid public endpoint path");
      if (from === to) return;
      api.revoke(to);
      const saved = read();
      if (!saved.some((s) => s.path === from)) return;
      deps.store.settings.set(KEY, JSON.stringify(saved.map((s) => (s.path === from ? { ...s, path: to } : s))));
    },
    protect(resolve: PublicRoutes): PublicRoutes {
      return (pathname) => {
        if (!known(pathname)) return;
        const route = resolve(pathname);
        if (!route) return;
        return {
          ...route,
          authorize: (headers) => api.authorize(pathname, headers) && route.authorize(deliveryHeaders(headers)),
          handle: (request, signal) => route.handle({ ...request, headers: deliveryHeaders(request.headers) }, signal),
        } satisfies PublicRoute;
      };
    },
  };
  return api;
}
export type PublicCredentials = ReturnType<typeof createPublicCredentials>;
