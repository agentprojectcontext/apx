import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon } from "../Icon";
import { makeStyles, useTheme } from "../theme";
import { responseOf, responseStatus, responseTitle } from "./blocks";
import { CompactRow } from "./CompactRow";

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
  project?: string | undefined;
  openThread?: ((id: string) => void) | undefined;
  children: ReactNode;
}) {
  const theme = useTheme();
  const s = useStyles();
  const response = responseOf(message);
  const title = t(response ? responseTitle(response) : "agentMessage", { name });
  return (
    <CompactRow
      title={title}
      icon="Bot"
      compact
      straight
      initiallyOpen
      summary={
        [project, response ? t(responseStatus(response).label) : undefined].filter(Boolean).join(" · ") || undefined
      }
    >
      {response && openThread ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={t("openSubthread", { name })}
          onPress={() => openThread(response.thread_id)}
          style={({ pressed }) => [s.source, pressed && { opacity: 0.6 }]}
        >
          <Text numberOfLines={1} style={s.sourceText}>
            {response.title} · {t("openSubthread", { name })}
          </Text>
          <Icon name="ChevronRight" size={13} color={theme.info} />
        </Pressable>
      ) : null}
      <View style={s.body}>{children}</View>
    </CompactRow>
  );
}
const useStyles = makeStyles((theme) => ({
  source: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 48 },
  sourceText: { color: theme.info, fontSize: 12, flexShrink: 1 },
  body: { gap: 4 },
}));
