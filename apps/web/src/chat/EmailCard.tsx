import "./EmailCard.css";
import {
  composeUrl,
  draftKey,
  type EmailBlock,
  emailText,
  isDraft,
  MAIL_APPS,
  type MailApp,
  type MailRoute,
  type SentDraft,
} from "@apx/protocol";
import { Button, ChannelIcon, IconButton, Icons, IntegrationIcon, Menu, type MenuEntry, ProjectTile } from "@apx/ui";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { openOutside } from "../panel/browserWindow.ts";
import { CopyButton } from "./MessageActions.tsx";

/** Seconds a send waits, so a click by mistake can be taken back. */
const UNDO_S = 5;
/** Lines of body shown before "Show all". */
const FOLD_LINES = 14;

type Sending = { route: MailRoute; left: number };

const routeIcon = (r: MailRoute, size = 14): ReactNode =>
  r.kind === "gmail" ? (
    <IntegrationIcon id="gmail" name="Gmail" size={size} />
  ) : (
    <ChannelIcon channel="email" size={size} />
  );

/** A web compose page opens in the browser; a mailto: link in the device's mail app (the desktop app hands it over). */
function openMail(url: string) {
  if (url.startsWith("mailto:") && !window.apxDesktop?.openExternal) window.location.assign(url);
  else openOutside(url);
}

/**
 * An email an agent wrote in a chat (an ```email block). A draft is sent from it through the owner's Gmail or a
 * mailbox channel, with a few seconds to undo; without one, it opens in their mail app or is copied.
 */
export function EmailCard({ mail, messageId }: { mail: EmailBlock; messageId: string }) {
  const t = useT();
  const draft = isDraft(mail);
  const key = draftKey(messageId, mail);
  const [routes, setRoutes] = useState<MailRoute[]>();
  const [chosen, setChosen] = useState<string>();
  const [sent, setSent] = useState<SentDraft>();
  const [sending, setSending] = useState<Sending>();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!draft) return;
    let stop = false;
    void client.call("mail.routes", { sent: [key] }).then(
      (r) => {
        if (stop) return;
        setRoutes(r.routes);
        setSent(r.sent[0]);
      },
      () => !stop && setRoutes([]),
    );
    return () => {
      stop = true;
    };
  }, [draft, key]);
  const route = routes?.find((r) => `${r.kind}:${r.id}` === chosen) ?? routes?.[0];

  const send = async (via: MailRoute) => {
    try {
      setSent(
        await client.call("mail.send", {
          route: { kind: via.kind, id: via.id },
          key,
          to: mail.to,
          cc: mail.cc,
          subject: mail.subject,
          body: mail.body,
        }),
      );
    } catch (e) {
      notify(t("mail.sendFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSending(undefined);
    }
  };
  const sendLater = useEffectEvent(send);
  // The countdown, then the send: undoing or leaving the chat before it ends sends nothing.
  useEffect(() => {
    if (!sending || sending.left === 0) return;
    const id = setTimeout(() => {
      if (sending.left > 1) setSending({ ...sending, left: sending.left - 1 });
      else {
        setSending({ ...sending, left: 0 });
        void sendLater(sending.route);
      }
    }, 1000);
    return () => clearTimeout(id);
  }, [sending]);

  const appLabel: Record<MailApp, string> = {
    mailto: t("mail.app"),
    gmail: t("mail.gmailWeb"),
    outlook: t("mail.outlookWeb"),
  };
  const opens: MenuEntry[] = MAIL_APPS.map((app) => ({
    label: appLabel[app],
    icon:
      app === "mailto" ? (
        <Icons.Mail size={14} />
      ) : (
        <IntegrationIcon id={app === "gmail" ? "gmail" : "outlook"} name={appLabel[app]} size={14} />
      ),
    onSelect: () => openMail(composeUrl(app, mail)),
  }));
  const ways: MenuEntry[] = (routes ?? []).map((r) => ({
    label: r.address ? `${r.label} · ${r.address}` : r.label,
    icon: routeIcon(r),
    checked: r === route,
    onSelect: () => setChosen(`${r.kind}:${r.id}`),
  }));

  const lines = mail.body.split("\n");
  const folded = !open && lines.length > FOLD_LINES;
  return (
    <div className="mailcard">
      <div className="mailcard__head">
        <ProjectTile tone="neutral" size={28} icon={<Icons.Mail size={15} />} />
        <div className="mailcard__title">{mail.subject || t("mail.noSubject")}</div>
        <div className="mailcard__tools">
          <CopyButton text={() => emailText(mail)} />
          {draft && (
            <Menu
              align="end"
              items={opens}
              trigger={<IconButton size="sm" label={t("mail.openIn")} icon={<Icons.ExternalLink size={13} />} />}
            />
          )}
        </div>
      </div>
      <dl className="mailcard__fields">
        {draft ? (
          <Field name={t("mail.to")} value={mail.to.join(", ")} />
        ) : (
          mail.from && <Field name={t("mail.from")} value={mail.from} />
        )}
        {mail.cc.length > 0 && <Field name={t("mail.cc")} value={mail.cc.join(", ")} />}
        {mail.date && <Field name={t("mail.date")} value={mail.date} />}
      </dl>
      <div className={`mailcard__body${folded ? " is-folded" : ""}`}>
        {folded ? lines.slice(0, FOLD_LINES).join("\n") : mail.body}
      </div>
      {lines.length > FOLD_LINES && (
        <Button variant="link" size="sm" className="mailcard__more" onClick={() => setOpen(!open)}>
          {open ? t("mail.less") : t("mail.more")}
        </Button>
      )}
      {draft && (
        <div className="mailcard__foot">
          {sent ? (
            <span className="mailcard__sent">
              <Icons.Check size={14} /> {t("mail.sent", { from: sent.via })}
            </span>
          ) : sending ? (
            <>
              <span className="mailcard__status">
                {sending.left ? t("mail.sendingIn", { n: sending.left }) : t("mail.sending")}
              </span>
              {sending.left > 0 && (
                <Button variant="secondary" size="sm" onClick={() => setSending(undefined)}>
                  {t("mail.undo")}
                </Button>
              )}
            </>
          ) : route ? (
            <>
              <div className="mailcard__split">
                <Button
                  size="sm"
                  leadingIcon={<Icons.Send size={14} />}
                  onClick={() => setSending({ route, left: UNDO_S })}
                >
                  {t("mail.send")}
                </Button>
                {ways.length > 1 && (
                  <Menu
                    align="end"
                    items={[{ type: "label", label: t("mail.sendWith") }, ...ways]}
                    trigger={
                      <IconButton
                        size="sm"
                        variant="primary"
                        label={t("mail.sendWith")}
                        icon={<Icons.ChevronDown size={14} />}
                      />
                    }
                  />
                )}
              </div>
              <span className="mailcard__via">
                {routeIcon(route, 14)} {route.address ?? route.label}
              </span>
            </>
          ) : (
            routes && (
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Icons.ExternalLink size={14} />}
                onClick={() => openMail(composeUrl("mailto", mail))}
              >
                {t("mail.openApp")}
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}

function Field({ name, value }: { name: string; value: string }) {
  return (
    <>
      <dt>{name}</dt>
      <dd>{value}</dd>
    </>
  );
}
