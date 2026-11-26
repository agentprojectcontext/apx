// secrets.provide_login: the owner answers an agent's sign-in card with a username and password (DECISIONS.md#d-264).
// The values stay in the core: saved as a variable marked for the site, or held for this sign-in only. The card's
// answer, which the agent reads, names the variable at most.

import type { Store } from "../domain/store.ts";
import type { Engine } from "../engine/engine.ts";
import { loginRequest } from "../engine/inputs.ts";
import { badRequest, conflict, notFound, unauthorized, unavailable } from "../errors.ts";
import type { Secrets } from "../secrets.ts";
import { marksFor, type SignIn } from "../sign-in.ts";
import type { Handlers } from "./router.ts";

const SAID = {
  es: { saved: (name: string) => `Guardado como ${name}`, once: "Solo esta vez" },
  en: { saved: (name: string) => `Saved as ${name}`, once: "Just this once" },
};

export function signInCardHandlers(d: {
  store: Store;
  secrets: Secrets;
  signIn: SignIn | undefined;
  respond: Engine["respond"];
}) {
  return {
    "secrets.provide_login": ({ input, username, password, save }, ctx) => {
      if (ctx.channel || ctx.agent) throw unauthorized("a sign-in is typed in the app, on the agent's card");
      if (!d.signIn) throw unavailable("signing in with stored secrets is not available here");
      const rec = d.store.inputs.get(input);
      const login = rec && loginRequest(rec);
      if (!rec || !login) throw notFound(`sign-in card ${input}`);
      if (rec.state !== "pending") throw conflict(`input ${input} is already ${rec.state}`);
      const user = username.trim();
      if (login.kind === "username" && !user) throw badRequest("this site asks for the username");
      const said = SAID[d.store.settings.get("owner_language") === "en" ? "en" : "es"];
      const name = save ? d.signIn.freeName(login.origin, user) : undefined;
      // Answered first: an expired card refuses here, before anything is kept.
      d.respond(input, { text: name ? said.saved(name) : said.once });
      if (name) {
        d.secrets.setLogin(name, { username: user, password });
        d.secrets.setSites(name, marksFor("login", [login.origin], "password"));
        d.signIn.answered(input, { name });
        return { name };
      }
      d.signIn.answered(input, { held: d.signIn.hold(rec.thread_id, login.origin, { username: user, password }) });
      return {};
    },
  } satisfies Partial<Handlers>;
}
