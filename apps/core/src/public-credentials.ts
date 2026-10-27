// Route-scoped public bearer credentials. Only secret references live in SQLite or idempotent RPC replies.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Store } from "./domain/store.ts";
import { badRequest } from "./errors.ts";
import type { Secrets } from "./secrets.ts";
import type { PublicRoute, PublicRoutes } from "./transport/hooks.ts";

export type PublicEndpoint = { path: string; label: string };
const Path = z.string().regex(/^\/flows\/[A-Za-z0-9_-]{1,100}$/);
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
const digest = (value: string) => createHash("sha256").update(value).digest();

export function createPublicCredentials(deps: { store: Store; secrets: Secrets; endpoints(): PublicEndpoint[] }) {
  const read = () => {
    try {
      const parsed = Saved.safeParse(JSON.parse(deps.store.settings.get(KEY) ?? "[]"));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  };
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
      const saved = read();
      const before = saved.find((s) => s.path === pathname);
      if (!before && saved.length >= 1000) throw badRequest("too many public endpoints");
      const name = `public-token-${randomBytes(16).toString("hex")}`;
      const entry = { path: pathname, secret_ref: `secret://${name}`, rotated_at: new Date().toISOString() };
      deps.secrets.set(name, `apxp_${randomBytes(32).toString("hex")}`);
      try {
        deps.store.settings.set(KEY, JSON.stringify([...saved.filter((s) => s.path !== pathname), entry]));
      } catch (err) {
        deps.secrets.set(name, null);
        throw err;
      }
      if (before) deps.secrets.set(before.secret_ref.slice(9), null);
      return entry;
    },
    revoke(pathname: string) {
      if (!Path.safeParse(pathname).success) throw badRequest("invalid public endpoint path");
      const saved = read();
      deps.store.settings.set(KEY, JSON.stringify(saved.filter((s) => s.path !== pathname)));
      for (const old of saved.filter((s) => s.path === pathname)) deps.secrets.set(old.secret_ref.slice(9), null);
      return { revoked: true };
    },
    authorize(pathname: string, headers: Record<string, string>) {
      if (!known(pathname)) return false;
      const supplied = headers.authorization;
      if (!supplied || !/^Bearer apxp_[a-f0-9]{64}$/.test(supplied)) return false;
      const ref = read().find((s) => s.path === pathname)?.secret_ref;
      const expected = deps.secrets.resolve(ref);
      return Boolean(expected && timingSafeEqual(digest(supplied.slice(7)), digest(expected)));
    },
    protect(resolve: PublicRoutes): PublicRoutes {
      return (pathname) => {
        if (!known(pathname)) return;
        const route = resolve(pathname);
        if (!route) return;
        return {
          ...route,
          authorize: (headers) => api.authorize(pathname, headers) && route.authorize(headers),
        } satisfies PublicRoute;
      };
    },
  };
  return api;
}
export type PublicCredentials = ReturnType<typeof createPublicCredentials>;
