// browser.sign_in: an APX agent puts one of the owner's stored secrets into a sign-in field without seeing it
// (DECISIONS.md#d-193). The value is resolved here, handed to the browser in the same call and never returned, logged
// or kept; the browser checks site, frame and field again when it fills.
import { SignInResult } from "@apx/protocol";
import type { Store } from "../domain/store.ts";
import { badRequest, unauthorized } from "../errors.ts";
import type { Secrets } from "../secrets.ts";
import type { SignIn } from "../sign-in.ts";
import { totp } from "../totp.ts";
import type { Handler } from "./router.ts";

const LEAK = {
  es: (site: string, secret: string) =>
    `${site} copió el valor de ${secret} en otra parte de la página. APX lo borró y no le muestra esa página al agente.`,
  en: (site: string, secret: string) =>
    `${site} copied the value of ${secret} elsewhere on the page. APX cleared it and keeps that page from the agent.`,
};

type Ctx = Parameters<Handler<"browser.sign_in">>[1];

export type SignInDeps = {
  store: Store;
  secrets: Secrets;
  signIn: SignIn;
  now?: () => number;
  /** The origin of the page a tab shows now. */
  tabOrigin(tab: string, ctx: Ctx): Promise<string>;
  /**
   * Hands the fill to the browser that holds the tab (never the isolated computer's: the value would leave the
   * owner's machine). Throws when there is none.
   */
  fill(params: Record<string, unknown>, ctx: Ctx): Promise<unknown>;
};

export function signInHandler(d: SignInDeps): Handler<"browser.sign_in"> {
  const now = d.now ?? Date.now;
  return async (p, ctx) => {
    const agent = ctx.agent;
    if (!agent) throw unauthorized("only APX's own agents sign in with the owner's stored secrets");
    const thread = d.store.threads.get(agent.thread_id);
    const key = d.signIn.keyFor(thread?.project_id ?? undefined, p.secret);
    const origin = await d.tabOrigin(p.tab, ctx);
    const done = (r: SignInResult): SignInResult => {
      // An audit line names the secret and the site, never the value.
      ctx.log.info(
        {
          agent: agent.id,
          run: agent.run_id,
          variable: p.secret,
          origin: r.origin,
          outcome: r.outcome,
          reason: r.reason,
        },
        "browser sign-in",
      );
      return r;
    };
    if (!key) return done({ outcome: "refused", origin, reason: `no stored secret named ${p.secret}` });
    if (!d.signIn.allows(agent.run_id, key, origin, p.kind))
      return done({ outcome: "refused", origin, reason: `${p.secret} is not allowed on ${origin || "this page"}` });
    const stored = d.secrets.resolve(`secret://${key}`);
    if (!stored) return done({ outcome: "refused", origin, reason: `${p.secret} has no value` });
    let value: string;
    try {
      value = p.kind === "otp" ? totp(stored, now()) : stored;
    } catch {
      return done({ outcome: "refused", origin, reason: `${p.secret} is not a one-time code seed` });
    }
    // The browser accepts only these origins at fill time: a page that moved on in between is refused there.
    const origins = [...d.signIn.marked(key, p.kind)];
    if (!origins.includes(origin) && d.signIn.allows(agent.run_id, key, origin, p.kind)) origins.push(origin);
    if (!origins.length) throw badRequest("no site to fill on");
    d.signIn.consume(agent.run_id, key, origin, p.kind);
    const r = SignInResult.parse(await d.fill({ tab: p.tab, ref: p.ref, by: p.by, kind: p.kind, origins, value }, ctx));
    if (r.outcome === "filled")
      d.secrets.markUsed(key, { origin: r.origin, at: new Date(now()).toISOString(), agent: agent.id });
    if (r.leaked) {
      const lang = d.store.settings.get("owner_language") === "en" ? "en" : "es";
      d.store.notifications.add({
        kind: "agent",
        level: "warn",
        title: d.store.agents.get(agent.id)?.name ?? agent.id,
        body: LEAK[lang](r.origin, p.secret),
        thread_id: agent.thread_id,
      });
    }
    return done(r);
  };
}
