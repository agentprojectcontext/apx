// browser_sign_in: the agent names a stored secret and a field; the browser fills it and the agent never sees the
// value (DECISIONS.md#d-193). On a site the owner did not mark for that secret, the owner is asked in the app.
import { BROWSER_CAP, SecretFieldKind, siteOrigin } from "@apx/protocol";
import { z } from "zod";
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
  },
  en: {
    q: (agent: string, secret: string, site: string, kind: string) =>
      `${agent} wants to use ${secret} ${kind} to sign in on ${site}. It will not see the value.`,
    once: "Once",
    always: "Always on this site",
    no: "No",
  },
};

export function browserSignInTool(
  store: Store,
  signIn: SignIn | undefined,
  own: (ctx: Pick<ToolContext, "agent" | "call">, tab: string) => Promise<string>,
  vm?: { hasThread(id: string): boolean },
) {
  return defineTool({
    needsCap: BROWSER_CAP,
    name: "browser_sign_in",
    description:
      "Put one of the owner's stored secrets (Variables, by name) into a sign-in field by ref: a password, a username or a one-time code (the current code of a stored seed). You never see the value and get back filled or refused. It works on the sites the owner allowed for that secret; on another one the owner is asked first. Never type passwords or codes with browser_type; with no stored secret, use browser_handoff.",
    args: z.object({
      tab: z.string().min(1).describe("tab id"),
      ref: z
        .string()
        .regex(/^e\d+$/)
        .describe("the field's ref, from the last snapshot"),
      secret: z
        .string()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/)
        .describe("the stored secret's name, like ACME_PASSWORD"),
      kind: SecretFieldKind.describe("the field: password, username or otp (one-time code)"),
    }),
    effect: "external",
    // The owner's answer on a site they did not mark may take a while.
    deadlineMs: 6 * 60_000,
    title: (a) => `Signed in with ${String(a.secret ?? "")}`,
    async run(a, ctx) {
      const tab = await own(ctx, a.tab);
      if (!signIn) return "refused: signing in with stored secrets is not available here; use browser_handoff";
      if (vm?.hasThread(ctx.thread.id))
        return "refused: stored secrets are filled only in the owner's browser, not in the isolated computer; use browser_handoff";
      const key = signIn.keyFor(lineage(store.projects, ctx.thread.project_id ?? undefined), a.secret);
      if (!key)
        return `refused: there is no stored secret named ${a.secret}; ask the owner to add it in Variables, or use browser_handoff`;
      // A secret marked for one kind of field never goes into another: a password into a visible username field.
      const kinds = SecretFieldKind.options.filter((k) => signIn.marked(key, k).length);
      if (kinds.length && !kinds.includes(a.kind))
        return `refused: ${a.secret} is for a ${kinds.join(" or ")} field, not ${a.kind}`;
      const url = (await ctx.call("browser.tabs", {})).tabs.find((t) => t.tab === tab)?.url ?? "";
      const origin = siteOrigin(url);
      if (!origin) return "refused: this tab is not on a website";
      if (!signIn.allows(ctx.run.id, key, origin, a.kind)) {
        const lang = store.settings.get("owner_language") === "en" ? "en" : "es";
        const t = ASK[lang];
        const r = await ctx.askOwner(
          t.q(ctx.agent.name, a.secret, origin, KIND[lang][a.kind]),
          [t.once, t.always, t.no],
          true,
          false,
          true,
        );
        if (r.state === "pending")
          return "not done: the owner has not answered whether you may use that secret there. End the turn and say you are waiting for them.";
        if (r.state !== "answered" || (r.answer !== t.once && r.answer !== t.always))
          return "refused: the owner did not allow that secret on this site; use browser_handoff if they should sign in themselves";
        if (r.answer === t.always) signIn.allowAlways(key, origin, a.kind);
        else signIn.allowOnce(ctx.run.id, key, origin, a.kind);
      }
      const r = await ctx.call("browser.sign_in", {
        tab,
        ref: a.ref,
        secret: a.secret,
        kind: a.kind,
        by: ctx.agent.id,
      });
      if (r.outcome === "filled")
        return `filled ${a.ref} on ${r.origin} with ${a.secret}; you cannot read it back. Take a new browser_snapshot, then send the form.`;
      return `refused: ${r.reason ?? "the browser did not fill it"}${r.leaked ? ". The owner was told. Do not retry on this page" : ""}`;
    },
  });
}
