import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { listWhen } from "../format";
import type { InboxAction, InboxItem } from "../hooks/inboxItems";
import type { Notice, Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import type { Answer } from "../protocol";
import { Icon } from "../ui/Icon";
import { AgentAvatar, Button, Card, EmptyState, PageTitle, Screen, Tag, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

export function InboxPage({
  data,
  items,
  open,
  read,
  respond,
  rerun,
  continueSession,
}: {
  data: Workspace;
  items: InboxItem[];
  open: (threadId: string) => void;
  read: (notice: Notice) => Promise<void>;
  respond: (input: string, response: Answer) => Promise<void>;
  rerun: (routine: string) => Promise<void>;
  continueSession: (session: string) => Promise<void>;
}) {
  const act = async (item: InboxItem, action: InboxAction) => {
    if (action.kind === "approve")
      await respond(action.input, { decision: "approve", ...(action.scope ? { scope: action.scope } : {}) });
    if (action.kind === "rerun") await rerun(action.routine);
    if (action.kind === "continue") await continueSession(action.session);
    if (item.notice) await read(item.notice);
    if (action.kind === "open" && action.thread) open(action.thread);
  };
  const subtitle =
    items.length === 0
      ? t("inboxNothing")
      : items.length === 1
        ? t("inboxOneWaiting")
        : t("inboxWaiting", { n: items.length });
  return (
    <Screen header={<PageTitle title={t("navInbox")} subtitle={subtitle} />}>
      {items.length ? (
        items.map((item) => <InboxCard key={item.id} item={item} data={data} act={act} />)
      ) : (
        <EmptyState title={t("inboxEmpty")} body={t("inboxEmptyBody")} />
      )}
    </Screen>
  );
}

function InboxCard({
  item,
  data,
  act,
}: {
  item: InboxItem;
  data: Workspace;
  act: (item: InboxItem, action: InboxAction) => Promise<void>;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState<string>();
  const agent = data.agents.find((a) => a.id === item.agentId);
  const press = (which: string, action: InboxAction) => {
    setBusy(which);
    act(item, action)
      .catch((error) => Alert.alert(t(item.label), error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(undefined));
  };
  return (
    <Card style={s.card}>
      <View style={s.top}>
        <Tag tone={item.tone}>{t(item.label)}</Tag>
        <Text numberOfLines={1} style={[type.meta, { flex: 1 }]}>
          {item.context}
        </Text>
        <Text style={type.meta}>{listWhen(item.at)}</Text>
      </View>
      <View style={s.body}>
        {agent && !item.icon ? (
          <AgentAvatar name={agent.name} blob={agent.blob} id={agent.id} size={32} />
        ) : (
          <View style={s.iconCircle}>
            <Icon name={item.icon ?? "Bell"} size={16} color={theme.fgMuted} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title}>{item.title}</Text>
          {item.body ? (
            <Text numberOfLines={4} style={type.muted}>
              {item.body}
            </Text>
          ) : null}
        </View>
      </View>
      {item.quote ? <Text style={s.quote}>{item.quote}</Text> : null}
      <View style={s.actions}>
        <Button
          label={t(item.primary.label)}
          busy={busy === "primary"}
          disabled={Boolean(busy)}
          onPress={() => press("primary", item.primary.action)}
        />
        {(item.more ?? []).map((m) => (
          <Button
            key={m.label}
            label={t(m.label)}
            variant="secondary"
            busy={busy === m.label}
            disabled={Boolean(busy)}
            onPress={() => press(m.label, m.action)}
          />
        ))}
        <Button
          label={t(item.secondary.label)}
          variant="secondary"
          busy={busy === "secondary"}
          disabled={Boolean(busy)}
          onPress={() => press("secondary", item.secondary.action)}
        />
      </View>
    </Card>
  );
}

const useStyles = makeStyles((theme) => ({
  card: { gap: 10 },
  top: { flexDirection: "row", alignItems: "center", gap: 8 },
  body: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.fg, fontSize: 15, fontWeight: "500" },
  quote: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 14,
    overflow: "hidden",
  },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));
