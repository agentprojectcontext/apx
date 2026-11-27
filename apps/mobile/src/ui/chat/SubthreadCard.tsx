import { Pressable, Text } from "react-native";
import { parseMarkdown, plainText } from "../../chat/markdown";
import { engineName } from "../../hooks/chatSelectors";
import type { Agent } from "../../hooks/useWorkspace";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { makeStyles } from "../theme";
import { responseStatus, responseTitle, took } from "./blocks";
import { CompactRow } from "./CompactRow";

type SubthreadPart = Extract<Message["parts"][number], { type: "subthread" }>;

/** Another agent's work stays a quiet disclosure, with the full report and its conversation in reach. */
export function SubthreadCard({
  part,
  agents,
  from,
  openThread,
}: {
  part: SubthreadPart;
  agents: Agent[];
  from: string;
  openThread?: ((id: string) => void) | undefined;
}) {
  const s = useStyles();
  const name = part.engine
    ? engineName(part.engine)
    : (part.worker ?? agents.find((agent) => agent.id === part.agent_id)?.name ?? t("agent"));
  const askedBy =
    part.asked_by === "owner"
      ? t("you")
      : part.asked_by
        ? (agents.find((agent) => agent.id === part.asked_by)?.name ?? from)
        : from;
  const status = responseStatus(part);
  return (
    <CompactRow
      title={part.summary ? t(responseTitle(part), { name }) : part.title}
      summary={t(status.label)}
      icon="Bot"
      compact
      warning={status.status === "failed"}
    >
      <Text style={s.subtitle}>
        {askedBy} → {name}
        {part.worker ? ` · ${t("subthreadWorker")}` : ""}
      </Text>
      {part.summary ? (
        <>
          <Text style={s.subtitle}>{part.title}</Text>
          <Text selectable style={s.summary}>
            {plainText(parseMarkdown(part.summary))}
          </Text>
        </>
      ) : null}
      {part.ms !== undefined || part.held ? (
        <Text style={s.meta}>
          {[
            part.ms !== undefined ? t("subthreadTook", { time: took(part.ms) }) : undefined,
            part.held ? t("subthreadHeld", { got: part.held.got, of: part.held.of }) : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      ) : null}
      {openThread ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("openSubthread", { name })}
          onPress={() => openThread(part.thread_id)}
          style={s.source}
        >
          <Text style={s.link}>{t("openSubthread", { name })}</Text>
        </Pressable>
      ) : null}
    </CompactRow>
  );
}

const useStyles = makeStyles((theme) => ({
  subtitle: { color: theme.fgMuted, fontSize: 12 },
  summary: { color: theme.fg, fontSize: 13, lineHeight: 18 },
  meta: { color: theme.fgSubtle, fontSize: 11, fontFamily: theme.mono },
  source: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  link: { color: theme.info, fontSize: 13 },
}));
