// The owner sends a draft an agent wrote in a chat, from its email card: through their Gmail or a mailbox channel.
// Their click is the decision, so nothing asks again; a draft's key is kept so the same card never sends twice.
import type { MailRoute } from "@apx/protocol";
import type { Channels } from "../channels/manager.ts";
import type { Store } from "../domain/store.ts";
import { badRequest, conflict, errorMessage } from "../errors.ts";
import { gmailApi } from "../integrations/gmail.ts";
import type { Google } from "../integrations/google.ts";
import type { Handlers } from "./router.ts";

/** Sent keys remembered: far more than the cards any chat shows. */
const KEEP = 500;

export function mailHandlers(store: Store, google: Google, channels: Pick<Channels, "mailboxes" | "compose">) {
  const routes = (): MailRoute[] => [
    ...(google.connected("gmail")
      ? [{ kind: "gmail" as const, id: "gmail", label: "Gmail", address: google.account("gmail") }]
      : []),
    ...channels.mailboxes().map((m) => ({ kind: "channel" as const, ...m })),
  ];
  return {
    "mail.routes": ({ sent }) => {
      const asked = new Set(sent);
      return { routes: routes(), sent: store.settings.read("mail_sent").filter((s) => asked.has(s.key)) };
    },
    "mail.send": async ({ route, key, to, cc, subject, body }) => {
      if (store.settings.read("mail_sent").some((s) => s.key === key)) throw conflict("This email was already sent");
      const via = routes().find((r) => r.kind === route.kind && r.id === route.id);
      if (!via) throw badRequest("That way of sending is not connected now");
      try {
        if (via.kind === "gmail") await gmailApi(google).send({ to, cc, subject, body });
        else await channels.compose(via.id, { to, cc, subject, body });
      } catch (err) {
        throw badRequest(`The email was not sent: ${errorMessage(err, 200)}`);
      }
      const done = { key, at: new Date().toISOString(), via: via.address ?? via.label };
      store.settings.write("mail_sent", [done, ...store.settings.read("mail_sent")].slice(0, KEEP));
      return done;
    },
  } satisfies Pick<Handlers, "mail.routes" | "mail.send">;
}
