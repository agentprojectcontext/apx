import { createContext, useContext, useEffect, useEffectEvent, useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { t } from "../../i18n";
import {
  type ApxClient,
  composeUrl,
  draftKey,
  type EmailBlock,
  emailText,
  isDraft,
  MAIL_APPS,
  type MailApp,
  type MailRoute,
  type SentDraft,
} from "../../protocol";
import { copyText } from "../copy";
import { Icon } from "../Icon";
import { Button } from "../kit";
import { OptionSheet } from "../OptionSheet";
import { makeStyles, useTheme } from "../theme";

/** What an email card in a message needs to send: the chat's client and the message it is in. */
export const MailContext = createContext<{ client?: ApxClient | undefined; messageId: string } | undefined>(undefined);

/** Seconds a send waits, so a tap by mistake can be taken back. */
const UNDO_S = 5;
const FOLD_LINES = 14;

const routeKey = (r: MailRoute) => `${r.kind}:${r.id}`;

/**
 * An email an agent wrote (an ```email block) or one that reached an email channel. A draft is sent from it through
 * the owner's Gmail or a mailbox channel, with a few seconds to undo, or opened in a mail app; any mail can be copied.
 */
export function EmailCard({ mail }: { mail: EmailBlock }) {
  const theme = useTheme();
  const s = useStyles();
  const ctx = useContext(MailContext);
  const client = ctx?.client;
  const draft = isDraft(mail);
  const key = draftKey(ctx?.messageId ?? "", mail);
  const [routes, setRoutes] = useState<MailRoute[]>();
  const [chosen, setChosen] = useState<string>();
  const [sent, setSent] = useState<SentDraft>();
  const [sending, setSending] = useState<{ route: MailRoute; left: number }>();
  const [sheet, setSheet] = useState<"open" | "route">();
  const [unfolded, setUnfolded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    if (!draft || !client) return;
    let live = true;
    void client.call("mail.routes", { sent: [key] }).then(
      (r) => {
        if (!live) return;
        setRoutes(r.routes);
        setSent(r.sent[0]);
      },
      () => live && setRoutes([]),
    );
    return () => {
      live = false;
    };
  }, [draft, client, key]);
  const route = routes?.find((r) => routeKey(r) === chosen) ?? routes?.[0];

  const sendLater = useEffectEvent(async (via: MailRoute) => {
    try {
      setSent(
        await client?.call("mail.send", {
          route: { kind: via.kind, id: via.id },
          key,
          to: mail.to,
          cc: mail.cc,
          subject: mail.subject,
          body: mail.body,
        }),
      );
    } catch (e) {
      setFailed(t("mailSendFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSending(undefined);
    }
  });
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
    mailto: t("mailApp"),
    gmail: t("mailGmailWeb"),
    outlook: t("mailOutlookWeb"),
  };
  const lines = mail.body.split("\n");
  const folded = !unfolded && lines.length > FOLD_LINES;
  const copy = () =>
    void copyText(emailText(mail)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.tile}>
          <Icon name="Mail" size={15} color={theme.fgMuted} />
        </View>
        <Text selectable style={s.title}>
          {mail.subject || t("mailNoSubject")}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("copyText")}
          hitSlop={8}
          onPress={copy}
          style={s.tool}
        >
          <Icon name={copied ? "Check" : "Copy"} size={15} color={theme.fgMuted} />
        </Pressable>
      </View>
      <View style={s.fields}>
        {draft ? (
          <Field name={t("mailTo")} value={mail.to.join(", ")} />
        ) : mail.from ? (
          <Field name={t("mailFrom")} value={mail.from} />
        ) : null}
        {mail.cc.length ? <Field name={t("mailCc")} value={mail.cc.join(", ")} /> : null}
        {mail.date ? <Field name={t("mailDate")} value={mail.date} /> : null}
      </View>
      <Text selectable style={s.body}>
        {folded ? lines.slice(0, FOLD_LINES).join("\n") : mail.body}
      </Text>
      {lines.length > FOLD_LINES ? (
        <Pressable accessibilityRole="button" onPress={() => setUnfolded(!unfolded)} style={s.more}>
          <Text style={s.moreText}>{unfolded ? t("mailLess") : t("mailMore")}</Text>
        </Pressable>
      ) : null}
      {draft ? (
        <View style={s.foot}>
          {sent ? (
            <View style={s.status}>
              <Icon name="Check" size={14} color={theme.fgMuted} />
              <Text style={s.statusText}>{t("mailSent", { from: sent.via })}</Text>
            </View>
          ) : sending ? (
            <View style={s.row}>
              <Text style={[s.statusText, { flex: 1 }]}>
                {sending.left ? t("mailSendingIn", { n: sending.left }) : t("mailSending")}
              </Text>
              {sending.left ? (
                <Button size="sm" variant="secondary" label={t("mailUndo")} onPress={() => setSending(undefined)} />
              ) : null}
            </View>
          ) : (
            <>
              <View style={s.row}>
                {route ? (
                  <Button
                    size="sm"
                    icon="Send"
                    label={t("mailSend")}
                    onPress={() => {
                      setFailed(undefined);
                      setSending({ route, left: UNDO_S });
                    }}
                  />
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  icon="ExternalLink"
                  label={t("mailOpen")}
                  onPress={() => setSheet("open")}
                />
              </View>
              {route ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("mailSendWith")}
                  disabled={(routes?.length ?? 0) < 2}
                  onPress={() => setSheet("route")}
                  style={s.via}
                >
                  <RouteMark route={route} />
                  <Text numberOfLines={1} style={[s.statusText, { flexShrink: 1 }]}>
                    {route.address ?? route.label}
                  </Text>
                  {(routes?.length ?? 0) > 1 ? <Icon name="ChevronDown" size={14} color={theme.fgSubtle} /> : null}
                </Pressable>
              ) : null}
              {failed ? <Text style={s.failed}>{failed}</Text> : null}
            </>
          )}
        </View>
      ) : null}
      {sheet === "open" ? (
        <OptionSheet
          title={t("mailOpenIn")}
          options={MAIL_APPS.map((app) => ({ value: app, label: appLabel[app] }))}
          onPick={(app) => void Linking.openURL(composeUrl(app, mail))}
          onClose={() => setSheet(undefined)}
        />
      ) : sheet === "route" && routes ? (
        <OptionSheet
          title={t("mailSendWith")}
          options={routes.map((r) => ({
            value: routeKey(r),
            label: r.label,
            ...(r.address ? { sub: r.address } : {}),
            leading: <RouteMark route={r} />,
          }))}
          {...(route ? { value: routeKey(route) } : {})}
          onPick={setChosen}
          onClose={() => setSheet(undefined)}
        />
      ) : null}
    </View>
  );
}

/** Gmail in its colour; a mailbox channel as a plain envelope. */
function RouteMark({ route }: { route: MailRoute }) {
  const theme = useTheme();
  return <Icon name="Mail" size={16} color={route.kind === "gmail" ? "#ea4335" : theme.fgMuted} />;
}

function Field({ name, value }: { name: string; value: string }) {
  const s = useStyles();
  return (
    <View style={s.field}>
      <Text style={s.fieldName}>{name}</Text>
      <Text selectable style={s.fieldValue}>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    alignSelf: "stretch",
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 6,
  },
  tile: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: theme.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, color: theme.fg, fontSize: 15, fontWeight: "600" },
  tool: { padding: 4 },
  fields: {
    gap: 2,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  field: { flexDirection: "row", gap: 10 },
  fieldName: { color: theme.fgSubtle, fontSize: 13, minWidth: 40 },
  fieldValue: { flex: 1, color: theme.fg, fontSize: 13 },
  body: { color: theme.fg, fontSize: 15, lineHeight: 22, padding: 12 },
  more: { paddingHorizontal: 12, paddingBottom: 10, marginTop: -6 },
  moreText: { color: theme.fgMuted, fontSize: 13, textDecorationLine: "underline" },
  foot: {
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.fill,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  via: { flexDirection: "row", alignItems: "center", gap: 6 },
  status: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusText: { color: theme.fgMuted, fontSize: 13 },
  failed: { color: theme.danger, fontSize: 13 },
}));
