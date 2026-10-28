import { Pressable, Text, View } from "react-native";
import { parseMarkdown, plainText } from "../../chat/markdown";
import type { Agent } from "../../hooks/useWorkspace";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon } from "../Icon";
import { Spinner } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { responseStatus, responseTitle, took } from "./blocks";

type SubthreadPart = Extract<Message["parts"][number], { type: "subthread" }>;

/** Another agent's (or a worker's) part in this answer: who asked whom, its state and the report it gave back. */
export function SubthreadCard({
  part,
  agents,
  from,
  openThread,
}: {
  part: SubthreadPart;
  agents: Agent[];
  /** The message's author, who asked unless the part names someone else. */
  from: string;
  openThread?: ((id: string) => void) | undefined;
}) {
  const theme = useTheme();
  const s = useStyles();
  const name = part.worker ?? agents.find((agent) => agent.id === part.agent_id)?.name ?? t("agent");
  const askedBy =
    part.asked_by === "owner"
      ? t("you")
      : part.asked_by
        ? (agents.find((agent) => agent.id === part.asked_by)?.name ?? from)
        : from;
  const status = responseStatus(part);
  const subtitle = [`${askedBy} → ${name}`, part.worker ? t("subthreadWorker") : "", part.summary ? part.title : ""]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("openSubthread", { name })}
      disabled={!openThread}
      onPress={() => openThread?.(part.thread_id)}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: theme.fill }]}
    >
      <View style={s.head}>
        {status.status === "running" ? (
          <Spinner size={14} />
        ) : (
          <Icon
            name={status.status === "waiting" ? "Clock" : status.status === "failed" ? "X" : "Check"}
            size={14}
            color={status.status === "failed" ? theme.danger : status.status === "done" ? theme.brand : theme.warning}
          />
        )}
        <Text numberOfLines={1} style={s.title}>
          {part.summary ? t(responseTitle(part), { name }) : part.title}
        </Text>
        <Text style={s.state}>{t(status.label)}</Text>
      </View>
      <Text numberOfLines={1} style={s.subtitle}>
        {subtitle}
      </Text>
      {part.summary ? (
        <Text numberOfLines={8} style={s.summary}>
          {plainText(parseMarkdown(part.summary))}
        </Text>
      ) : null}
      {part.ms !== undefined ? <Text style={s.meta}>{t("subthreadTook", { time: took(part.ms) })}</Text> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    alignSelf: "stretch",
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: theme.fg, fontSize: 14, fontWeight: "500", flexShrink: 1 },
  state: { color: theme.fgSubtle, fontSize: 12, marginLeft: "auto" },
  subtitle: { color: theme.fgMuted, fontSize: 12 },
  summary: { color: theme.fg, fontSize: 14, lineHeight: 20, marginTop: 2 },
  meta: { color: theme.fgSubtle, fontSize: 11, fontFamily: theme.mono },
}));
