// Which stored secrets an agent may put into a sign-in field, on which sites (DECISIONS.md#d-193). The owner's marks
// live with the secret (Variables); a "Once" from the owner's card covers one fill in that turn and nothing more.
import { type SecretFieldKind, siteAllowed } from "@apx/protocol";
import { projectSecretName, type SecretSite, type Secrets } from "./secrets.ts";

/** How long an unused "Once" waits for its fill. */
const ONCE_MS = 5 * 60_000;

export type SignIn = ReturnType<typeof createSignIn>;

export function createSignIn(secrets: Secrets, now: () => number = Date.now) {
  const once = new Map<string, number>();
  const onceKey = (run: string, key: string, origin: string, kind: SecretFieldKind) =>
    JSON.stringify([run, key, origin, kind]);
  const sweep = () => {
    for (const [k, until] of once) if (until <= now()) once.delete(k);
  };
  return {
    /**
     * The stored name a secret goes by in a chat: the project's own value first (then its parent's, for a subproject:
     * `projects` nearest first), as `secret://` references do.
     */
    keyFor(projects: readonly string[], name: string): string | undefined {
      for (const project of projects)
        if (secrets.listed(projectSecretName(project, name))) return projectSecretName(project, name);
      return secrets.listed(name) ? name : undefined;
    },
    /** The origins the owner marked for this kind of field ("*" included). */
    marked(key: string, kind: SecretFieldKind): string[] {
      return secrets
        .sites(key)
        .filter((s) => s.kind === kind)
        .map((s) => s.origin);
    },
    /** Whether a fill on that origin is allowed now, by a mark or an unused "Once" of this turn. */
    allows(run: string, key: string, origin: string, kind: SecretFieldKind): boolean {
      sweep();
      return siteAllowed(this.marked(key, kind), origin) || once.has(onceKey(run, key, origin, kind));
    },
    allowOnce(run: string, key: string, origin: string, kind: SecretFieldKind): void {
      sweep();
      once.set(onceKey(run, key, origin, kind), now() + ONCE_MS);
    },
    /** Takes the "Once" for a fill that is about to happen: it never covers a second one. */
    consume(run: string, key: string, origin: string, kind: SecretFieldKind): void {
      once.delete(onceKey(run, key, origin, kind));
    },
    /** The owner's "Always on this site": the same mark they set in Variables (never `*`). */
    allowAlways(key: string, origin: string, kind: SecretFieldKind): void {
      const sites = secrets.sites(key);
      if (!sites.some((s) => s.origin === origin && s.kind === kind))
        secrets.setSites(key, [...sites, { origin, kind } satisfies SecretSite]);
    },
  };
}
