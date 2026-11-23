// Which stored secrets an agent may put into a sign-in field, on which sites (DECISIONS.md#d-193). The owner's marks
// live with the secret (Variables); a "Once" from the owner's card covers one fill in that turn and nothing more.
// A sign-in the owner types on an agent's card is kept here for that sign-in only, or saved (DECISIONS.md#d-264).
import { randomBytes } from "node:crypto";
import { type SecretFieldKind, siteAllowed } from "@apx/protocol";
import { systemSecretOwner } from "./secret-names.ts";
import {
  type Login,
  projectSecretName,
  type SecretField,
  type SecretSite,
  type Secrets,
  splitSecretName,
} from "./secrets.ts";

/** How long an unused "Once" waits for its fill. */
const ONCE_MS = 5 * 60_000;
/** How long a sign-in typed for one use stays usable: a site that asks the username and the password on two pages. */
const HELD_MS = 10 * 60_000;
/** Words of a site's address that say nothing about whose site it is. */
const GENERIC = new Set(
  "www accounts account login signin auth id sso my app web secure portal online com net org co gov edu io".split(" "),
);
/** A plain variable is offered for a site only when its name says it signs in. */
const CREDENTIAL = /(user|pass|pwd|login|auth|email|mail|clave|usuario|otp|totp|2fa)/i;

/** The marks a sign-in variable gets on each site: one per field it fills. */
export function marksFor(field: SecretField | undefined, origins: string[], kind: SecretFieldKind): SecretSite[] {
  const kinds: SecretFieldKind[] = field === "login" ? ["username", "password"] : [field ?? kind];
  return [...new Set(origins)].flatMap((origin) => kinds.map((k) => ({ origin, kind: k })));
}

/** The words that name a site: "accounts.google.com" → ["google"], "app.acme.co.uk" → ["acme"]. */
export function siteWords(origin: string): string[] {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return [];
  }
  const labels = host.split(".").filter(Boolean);
  if (labels.length > 1) labels.pop();
  return labels.filter((l) => !GENERIC.has(l) && !/^\d+$/.test(l));
}

/** A variable name for a sign-in the owner saves: the site, then who signs in ("GOOGLE_MANU_LOGIN"). */
export function loginName(origin: string, username: string): string {
  const clean = (s: string, max: number) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, max);
  const site = clean(siteWords(origin).at(-1) ?? "SITE", 24) || "SITE";
  const who = clean(username.split("@")[0] ?? "", 20);
  return [site, who, "LOGIN"].filter(Boolean).join("_");
}

export type SignIn = ReturnType<typeof createSignIn>;

export function createSignIn(secrets: Secrets, now: () => number = Date.now) {
  const once = new Map<string, number>();
  const held = new Map<
    string,
    { thread: string; origin: string; login: Login; left: SecretFieldKind[]; until: number }
  >();
  const answers = new Map<string, { name?: string; held?: string }>();
  const onceKey = (run: string, key: string, origin: string, kind: SecretFieldKind) =>
    JSON.stringify([run, key, origin, kind]);
  const sweep = () => {
    for (const [k, until] of once) if (until <= now()) once.delete(k);
    for (const [k, h] of held) if (h.until <= now() || !h.left.length) held.delete(k);
  };
  const api = {
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
    /** The fields a secret goes into: what the owner said it is for, else the kinds it is marked for (none: unsaid). */
    kinds(key: string): SecretFieldKind[] {
      const field = secrets.field(key);
      if (field === "login") return ["username", "password"];
      if (field) return [field];
      return [...new Set(secrets.sites(key).map((s) => s.kind))];
    },
    /** Whether a fill on that origin is allowed now, by a mark or an unused "Once" of this turn. */
    allows(run: string, key: string, origin: string, kind: SecretFieldKind): boolean {
      sweep();
      return siteAllowed(api.marked(key, kind), origin) || once.has(onceKey(run, key, origin, kind));
    },
    allowOnce(run: string, key: string, origin: string, kind: SecretFieldKind): void {
      sweep();
      once.set(onceKey(run, key, origin, kind), now() + ONCE_MS);
    },
    /** Takes the "Once" for a fill that is about to happen: it never covers a second one. */
    consume(run: string, key: string, origin: string, kind: SecretFieldKind): void {
      once.delete(onceKey(run, key, origin, kind));
    },
    /** The owner's "Always on this site": the same mark they set in Variables (never `*`); a sign-in gets both fields. */
    allowAlways(key: string, origin: string, kind: SecretFieldKind): void {
      const sites = secrets.sites(key);
      const add = marksFor(secrets.field(key), [origin], kind).filter(
        (m) => !sites.some((s) => s.origin === m.origin && s.kind === m.kind),
      );
      if (add.length) secrets.setSites(key, [...sites, ...add]);
    },
    /**
     * The owner's stored secrets an agent could sign in with on this site: `marked` for it (used without asking),
     * else `named` after it (the owner is asked). Names as the chat knows them; APX's own are never offered.
     */
    candidates(projects: readonly string[], origin: string, kind: SecretFieldKind) {
      const words = siteWords(origin);
      const names = new Set<string>();
      for (const s of secrets.list()) {
        const { project_id, name } = splitSecretName(s.name);
        if (!project_id || projects.includes(project_id)) names.add(name);
      }
      const marked: string[] = [];
      const named: string[] = [];
      for (const name of [...names].sort()) {
        const key = api.keyFor(projects, name);
        if (!key || systemSecretOwner(key, { providers: [], integrations: [] })) continue;
        const kinds = api.kinds(key);
        if (kinds.length && !kinds.includes(kind)) continue;
        if (secrets.sites(key).some((s) => s.origin === origin && s.kind === kind)) {
          marked.push(name);
          continue;
        }
        if (!kinds.length && !CREDENTIAL.test(name)) continue;
        const lower = name.toLowerCase();
        const tokens = lower.split(/[_.-]+/);
        if (words.some((w) => tokens.includes(w) || (w.length >= 4 && lower.includes(w)))) named.push(name);
      }
      return { marked, named };
    },
    /** A name for a sign-in the owner saves that no variable (global or a project's own) has yet. */
    freeName(origin: string, username: string): string {
      const base = loginName(origin, username);
      const taken = new Set(secrets.list().map((s) => splitSecretName(s.name).name));
      if (!taken.has(base)) return base;
      for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
    },
    /**
     * A sign-in the owner typed for this one use: it fills each of its fields once, in that chat and on that site, for
     * a few minutes. Returns the handle the fill names it by.
     */
    hold(thread: string, origin: string, login: Login): string {
      sweep();
      const handle = `once-${randomBytes(6).toString("hex")}`;
      const left: SecretFieldKind[] = login.username ? ["username", "password"] : ["password"];
      held.set(handle, { thread, origin, login, left, until: now() + HELD_MS });
      return handle;
    },
    /** The held sign-in of that chat that can still fill this field on this site. */
    heldFor(thread: string, origin: string, kind: SecretFieldKind): string | undefined {
      sweep();
      for (const [handle, h] of held)
        if (h.thread === thread && h.origin === origin && h.left.includes(kind)) return handle;
      return undefined;
    },
    /** Takes a held sign-in's value for one fill; undefined when it is not that chat's, that site's or used up. */
    takeHeld(thread: string, handle: string, origin: string, kind: SecretFieldKind): string | undefined {
      sweep();
      const h = held.get(handle);
      if (!h || h.thread !== thread || h.origin !== origin || !h.left.includes(kind)) return undefined;
      h.left = h.left.filter((k) => k !== kind);
      return kind === "username" ? h.login.username : kind === "password" ? h.login.password : undefined;
    },
    isHeld(handle: string): boolean {
      return held.has(handle);
    },
    /** What the owner's sign-in card ended in, for the tool that asked: a saved variable or a held sign-in. */
    answered(input: string, r: { name?: string; held?: string }): void {
      answers.set(input, r);
    },
    takeAnswer(input: string): { name?: string; held?: string } | undefined {
      const r = answers.get(input);
      answers.delete(input);
      return r;
    },
  };
  return api;
}
