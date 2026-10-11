import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { ago } from "../format";
import type { Workspace } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { AgentAvatar, ListGroup, OwnerAvatar, Spinner, type } from "../ui/kit";
import { Markdown } from "../ui/Markdown";
import { theme } from "../ui/theme";
import type { TaskComment } from "./comments";

/** What the owner and the agents wrote on the task, oldest first; none yet says how to start. */
export function Comments({ comments, data }: { comments?: TaskComment[]; data: Workspace }) {
  if (!comments)
    return (
      <View style={s.loading}>
        <Spinner size={18} />
      </View>
    );
  if (!comments.length)
    return (
      <View style={s.empty}>
        <Icon name="MessageSquare" size={22} color={theme.fgSubtle} />
        <Text style={[type.rowTitle, s.center]}>{t("tkCommentsEmpty")}</Text>
        <Text style={[type.muted, s.center]}>{t("tkCommentsEmptyBody")}</Text>
      </View>
    );
  return (
    <ListGroup>
      {comments.map((comment) => {
        const agent = comment.by === "owner" ? undefined : data.agents.find((item) => item.id === comment.by);
        const name = comment.by === "owner" ? data.owner || t("tkYou") : (agent?.name ?? comment.by);
        return (
          <View key={comment.id} style={s.comment}>
            <View style={s.head}>
              {comment.by === "owner" ? (
                <OwnerAvatar name={name} size={24} />
              ) : (
                <AgentAvatar name={name} blob={agent?.blob} id={agent?.id ?? comment.by} size={24} />
              )}
              <Text style={[type.rowTitle, { flex: 1 }]} numberOfLines={1}>
                {name}
              </Text>
              <Text style={type.meta}>{ago(comment.at)}</Text>
            </View>
            <Markdown text={comment.text} />
          </View>
        );
      })}
    </ListGroup>
  );
}

/** The box under the task to write a comment; an @agent in it asks that agent. Clears once it went out. */
export function CommentBox({ send }: { send: (text: string) => Promise<void> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = Boolean(text.trim()) && !busy;
  const submit = () => {
    if (!ready) return;
    setBusy(true);
    send(text.trim())
      .then(() => setText(""))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  return (
    <View style={s.box}>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={t("tkCommentHint")}
        placeholderTextColor={theme.fgSubtle}
        accessibilityLabel={t("tkComment")}
        maxLength={20_000}
        multiline
        editable={!busy}
        style={s.input}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("send")}
        accessibilityState={{ disabled: !ready, busy }}
        disabled={!ready}
        onPress={submit}
        hitSlop={6}
        style={[s.send, { backgroundColor: ready ? theme.accent : theme.fillStrong }]}
      >
        {busy ? (
          <Spinner size={14} />
        ) : (
          <Icon name="ArrowUp" size={18} color={ready ? theme.accentFg : theme.fgMuted} />
        )}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  loading: { padding: 24, alignItems: "center" },
  empty: { alignItems: "center", gap: 6, paddingVertical: 20, paddingHorizontal: 24 },
  center: { textAlign: "center" },
  comment: { gap: 6, paddingVertical: 10, paddingHorizontal: 14 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  box: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.bg,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 20,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 15,
  },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
