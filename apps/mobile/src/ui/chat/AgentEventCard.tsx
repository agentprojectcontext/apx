import { type ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon } from "../Icon";
import { makeStyles, useTheme } from "../theme";
import { responseOf, responseStatus, responseTitle } from "./blocks";

/** Another agent's message in the owner's own chat: an event that folds, never a new participant. */
export function AgentEventCard({
  message,
  name,
  project,
  openThread,
  children,
}: {
  message: Message;
  name: string;
  /** The name of the project the reply was about. */
  project?: string | undefined;
  openThread?: ((id: string) => void) | undefined;
  children: ReactNode;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(true);
  const response = responseOf(message);
  const title = t(response ? responseTitle(response) : "agentMessage", { name });
  return (
    <View style={s.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        onPress={() => setOpen((value) => !value)}
        style={s.head}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.fgMuted} />
        <Icon name="Bot" size={14} color={theme.fgMuted} />
        <Text numberOfLines={1} style={s.title}>
          {title}
        </Text>
        {project ? (
          <Text numberOfLines={1} style={s.project}>
            {project}
          </Text>
        ) : null}
        {response ? <Text style={s.state}>{t(responseStatus(response).label)}</Text> : null}
      </Pressable>
      {open && response && openThread ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => openThread(response.thread_id)}
          style={({ pressed }) => [s.source, pressed && { opacity: 0.6 }]}
        >
          <Text numberOfLines={1} style={s.sourceText}>
            {response.title} · {t("openSubthread", { name })}
          </Text>
          <Icon name="ChevronRight" size={13} color={theme.info} />
        </Pressable>
      ) : null}
      {open ? <View style={s.body}>{children}</View> : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: { alignSelf: "stretch", borderLeftWidth: 2, borderColor: theme.border, paddingLeft: 10, gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 28 },
  title: { color: theme.fgMuted, fontSize: 13, fontWeight: "500", flexShrink: 1 },
  project: { color: theme.fgSubtle, fontSize: 12, flexShrink: 1 },
  state: { color: theme.fgSubtle, fontSize: 12, marginLeft: "auto" },
  source: { flexDirection: "row", alignItems: "center", gap: 4 },
  sourceText: { color: theme.info, fontSize: 12, flexShrink: 1 },
  body: { gap: 4 },
}));
