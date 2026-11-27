// browser_sign_in: the agent names a stored secret and a field; the browser fills it and the agent never sees the
// value (DECISIONS.md#d-193). On a site the owner did not mark for that secret, the owner is asked in the app.
// Without a name, APX finds the owner's sign-in for the site, asks which one, or has them type one (DECISIONS.md#d-264).
import { BROWSER_CAP, SecretFieldKind, siteOrigin } from "@apx/protocol";
import { z } from "zod";
import { markOwnerSessions, profileOf } from "../domain/browser-sessions.ts";
import { lineage } from "../domain/projects.ts";
import type { Store } from "../domain/store.ts";
import type { SignIn } from "../sign-in.ts";
import { defineTool, type ToolContext } from "./types.ts";

const KIND = {
  es: { password: "como contraseña", username: "como usuario", otp: "como código de un solo uso" },
  en: { password: "as a password", username: "as a username", otp: "as a one-time code" },
};
const ASK = {
  es: {
    q: (agent: string, secret: string, site: string, kind: string) =>
      `${agent} quiere usar ${secret} ${kind} para iniciar sesión en ${site}. No va a ver el valor.`,
    once: "Una vez",
    always: "Siempre en este sitio",
    no: "No",
    which: (agent: string, site: string, names: string[]) =>
      names.length === 1
        ? `${agent} quiere iniciar sesión en ${site}. ¿Usa ${names[0]}? No va a ver el valor.`
        : `${agent} quiere iniciar sesión en ${site}. ¿Cuál usa? No va a ver el valor.`,
    yes: "Sí",
    other: "Escribir otro",
    type: (agent: string, site: string) =>
      `${agent} necesita iniciar sesión en ${site}. Escribí el usuario y la contraseña: el agente no los ve.`,
  },
  en: {
    q: (agent: string, secret: string, site: string, kind: string) =>
      `${agent} wants to use ${secret} ${kind} to sign in on ${site}. It will not see the value.`,
    once: "Once",
    always: "Always on this site",
    no: "No",
    which: (agent: string, site: string, names: string[]) =>
      names.length === 1
        ? `${agent} wants to sign in on ${site}. Use ${names[0]}? It will not see the value.`
        : `${agent} wants to sign in on ${site}. Which one should it use? It will not see the value.`,
    yes: "Yes",
    other: "Type another",
    type: (agent: string, site: string) =>
      `${agent} needs to sign in on ${site}. Type the username and password: the agent does not see them.`,
  },
};
/** A site as the owner reads it: the host, with the scheme only when it is not https. */
const siteLabel = (origin: string) => (origin.startsWith("https://") ? origin.slice(8) : origin);
/** At most this many of the owner's variables are offered on one card. */
const OFFERED = 4;

/** The secret to fill with and how it was found, or what to tell the agent instead. */
type Found = { secret: string; how: "stored" | "saved" | "typed" } | string;

export function browserSignInTool(
  store: Store,
  signIn: SignIn | undefined,
  own: (ctx: Pick<ToolContext, "agent" | "call">, tab: string) => Promise<string>,
  vm?: { hasThread(id: string): boolean },
) {
  const lang = () => (store.settings.get("owner_language") === "en" ? "en" : "es");

  /** The owner types a username and password on a card: kept for this time, or saved as a variable. */
  async function typed(s: SignIn, ctx: ToolContext, origin: string, kind: "username" | "password"): Promise<Found> {
    const r = await ctx.askSignIn(ASK[lang()].type(ctx.agent.name, siteLabel(origin)), { origin, kind });
    const got = r.state === "answered" ? s.takeAnswer(r.id) : undefined;
    if (got?.name) return { secret: got.name, how: "saved" };
    if (got?.held) return { secret: got.held, how: "typed" };
    if (r.state === "expired")
      return "not done: the owner did not type a sign-in in time. Tell them you need to sign in there, or use browser_handoff";
    return "refused: the owner did not give a sign-in for this site; use browser_handoff if they should sign in themselves";
  }

  /** The owner's sign-in for this site and field: one marked for it, one they pick, or one they type. */
  async function find(s: SignIn, ctx: ToolContext, origin: string, kind: SecretFieldKind): Promise<Found> {
    const held = s.heldFor(ctx.thread.id, origin, kind);
    if (held) return { secret: held, how: "typed" };
    const projects = lineage(store.projects, ctx.thread.project_id ?? undefined);
    const { marked, named } = s.candidates(projects, origin, kind);
    if (marked.length === 1 && marked[0]) return { secret: marked[0], how: "stored" };
    const offered = (marked.length ? marked : named).slice(0, OFFERED);
    const t = ASK[lang()];
    const typeable = kind !== "otp";
    if (offered.length) {
      const single = offered.length === 1;
      const options = [...(single ? [t.yes] : offered), ...(typeable ? [t.other] : []), t.no];
      const r = await ctx.askSignIn(t.which(ctx.agent.name, siteLabel(origin), offered), undefined, options);
      const answer = r.state === "answered" ? r.answer : undefined;
      const chosen = single && answer === t.yes ? offered[0] : offered.find((n) => n === answer);
      if (chosen) {
        // The owner said which one is for this site: from now on it is used here without asking.
        const key = s.keyFor(projects, chosen);
        if (key && !marked.includes(chosen)) s.allowAlways(key, origin, kind);
        return { secret: chosen, how: "stored" };
      }
      if (answer !== t.other || !typeable)
        return r.state === "expired"
          ? "not done: the owner did not answer which sign-in to use. Tell them you are waiting, or use browser_handoff"
          : "refused: the owner did not pick a sign-in for this site; use browser_handoff if they should sign in themselves";
    }
    if (kind === "otp")
      return "refused: the owner keeps no one-time code seed for this site; use browser_handoff for the code";
    return typed(s, ctx, origin, kind);
  }

  return defineTool({
    needsCap: BROWSER_CAP,
    name: "browser_sign_in",
    description:
      "Fill a sign-in field by ref with the owner's sign-in: a username, a password or a one-time code. You never see the value and get back filled or refused. Without `secret`, APX finds the owner's sign-in for this site: one set for it, one they confirm, or one they type on a card (once or saved). Give `secret` (a Variables name) only when you know it. Use it on every login form before browser_handoff; never type passwords or codes with browser_type.",
    args: z.object({
      tab: z.string().min(1).describe("tab id"),
      ref: z
        .string()
        .regex(/^e\d+$/)
        .describe("the field's ref, from the last snapshot"),
      secret: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/)
        .optional()
        .describe("a stored secret's name, like ACME_LOGIN; leave it out to let APX find it"),
      kind: SecretFieldKind.describe("the field: password, username or otp (one-time code)"),
    }),
    effect: "external",
    // The owner's answer, or the sign-in they type, may take a while.
    deadlineMs: 6 * 60_000,
    title: (a) => (a.secret ? `Signed in with ${String(a.secret)}` : "Signed in"),
    async run(a, ctx) {
      const tab = await own(ctx, a.tab);
      if (!signIn) return "refused: signing in with stored secrets is not available here; use browser_handoff";
      if (vm?.hasThread(ctx.thread.id))
        return "refused: stored secrets are filled only in the owner's browser, not in the isolated computer; use browser_handoff";
      const url = (await ctx.call("browser.tabs", {})).tabs.find((t) => t.tab === tab)?.url ?? "";
      const origin = siteOrigin(url);
      if (!origin) return "refused: this tab is not on a website";
      // A sign-in leaves the owner's session in this profile (DECISIONS.md#d-283).
      markOwnerSessions(store, profileOf(ctx.agent));
      let pick: Found;
      if (a.secret) {
        const key = signIn.keyFor(lineage(store.projects, ctx.thread.project_id ?? undefined), a.secret);
        if (!key)
          return `refused: there is no stored secret named ${a.secret}; call browser_sign_in without secret to find or ask for one`;
        // A secret for one kind of field never goes into another: a password into a visible username field.
        const kinds = signIn.kinds(key);
        if (kinds.length && !kinds.includes(a.kind))
          return `refused: ${a.secret} is for a ${kinds.join(" or ")} field, not ${a.kind}`;
        if (!signIn.allows(ctx.run.id, key, origin, a.kind)) {
          const t = ASK[lang()];
          const r = await ctx.askSignIn(
            t.q(ctx.agent.name, a.secret, siteLabel(origin), KIND[lang()][a.kind]),
            undefined,
            [t.once, t.always, t.no],
          );
          if (r.state !== "answered" || (r.answer !== t.once && r.answer !== t.always))
            return "refused: the owner did not allow that secret on this site; use browser_handoff if they should sign in themselves";
          if (r.answer === t.always) signIn.allowAlways(key, origin, a.kind);
          else signIn.allowOnce(ctx.run.id, key, origin, a.kind);
        }
        pick = { secret: a.secret, how: "stored" };
      } else pick = await find(signIn, ctx, origin, a.kind);
      if (typeof pick === "string") return pick;
      const r = await ctx.call("browser.sign_in", {
        tab,
        ref: a.ref,
        secret: pick.secret,
        kind: a.kind,
        by: ctx.agent.id,
      });
      if (r.outcome !== "filled")
        return `refused: ${r.reason ?? "the browser did not fill it"}${r.leaked ? ". The owner was told. Do not retry on this page" : ""}`;
      const what =
        pick.how === "typed"
          ? "the sign-in the owner typed for this time"
          : pick.how === "saved"
            ? `${pick.secret}, which the owner just saved`
            : pick.secret;
      return `filled ${a.ref} on ${r.origin} with ${what}; you cannot read it back. Take a new browser_snapshot; fill the other sign-in field the same way (browser_sign_in without secret), then send the form.`;
    },
  });
}
