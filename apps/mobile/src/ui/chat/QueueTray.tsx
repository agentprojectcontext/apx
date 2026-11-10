// The owner's messages in line for the agent's next turn, above the composer: one line each, in the order they will
// run. "Send now" is in sight; a tap on a message gives the rest (edit, move, remove), since a phone has no hover.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { wordsOf } from "../../chat/waiting";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon } from "../Icon";
import { BottomSheet, ListRow, Spinner } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { EditWaitingSheet, type WaitingActions } from "./WaitingControls";

const filesOf = (message: Message) => message.parts.filter((p) => p.type === "file" || p.type === "image").length;

export function QueueTray({ line, name, actions }: { line: Message[]; name: string; actions: WaitingActions }) {
  const theme = useTheme();
  const s = useStyles();
  const [open, setOpen] = useState(true);
  const [picked, setPicked] = useState<{ id: string; edit?: boolean }>();
  const [busy, setBusy] = useState<string>();
  const run = (id: string, job: () => Promise<unknown>) => {
    setBusy(id);
    void job()
      .catch(() => undefined)
      .finally(() => setBusy(undefined));
  };
  const message = line.find((m) => m.id === picked?.id);
  const at = message ? line.indexOf(message) : -1;
  if (!line.length) return null;
  return (
    <View style={s.tray}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t(open ? "waitingHide" : "waitingShow")}
        onPress={() => setOpen((v) => !v)}
        style={s.head}
      >
        <Icon name="Clock" size={13} color={theme.fgSubtle} />
        <Text style={s.title}>{t("waitingQueue")}</Text>
        <Text style={s.count}>{line.length}</Text>
        <Text numberOfLines={1} style={s.sub}>
          {t("waitingLineFor", { name })}
        </Text>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} size={14} color={theme.fgMuted} />
      </Pressable>
      {open
        ? line.map((item) => {
            const files = filesOf(item);
            return (
              <View key={item.id} style={s.row}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityHint={t("waitingOptions")}
                  onPress={() => setPicked({ id: item.id })}
                  style={({ pressed }) => [s.textWrap, pressed && { opacity: 0.6 }]}
                >
                  {files > 0 ? (
                    <View style={s.files}>
                      <Icon name="Paperclip" size={12} color={theme.fgSubtle} />
                      <Text style={s.count}>{files}</Text>
                    </View>
                  ) : null}
                  <Text numberOfLines={1} style={s.text}>
                    {wordsOf(item)}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("waitingSendNow")}
                  hitSlop={6}
                  disabled={busy === item.id}
                  onPress={() => run(item.id, () => actions.sendNow(item))}
                  style={({ pressed }) => [s.act, pressed && { backgroundColor: theme.fillHover }]}
                >
                  {busy === item.id ? <Spinner size={12} /> : <Icon name="Zap" size={14} color={theme.fg} />}
                </Pressable>
              </View>
            );
          })
        : null}
      {message && !picked?.edit ? (
        <BottomSheet title={wordsOf(message).slice(0, 80)} onClose={() => setPicked(undefined)}>
          {(dismiss) => (
            <>
              <ListRow
                label={t("waitingSendNow")}
                leading={<Icon name="Zap" size={18} color={theme.fgMuted} />}
                chevron={false}
                onPress={() => dismiss(() => run(message.id, () => actions.sendNow(message)))}
              />
              <ListRow
                label={t("waitingEdit")}
                leading={<Icon name="Pencil" size={18} color={theme.fgMuted} />}
                chevron={false}
                onPress={() => setPicked({ id: message.id, edit: true })}
              />
              {at > 0 ? (
                <ListRow
                  label={t("waitingUp")}
                  leading={<Icon name="ArrowUp" size={18} color={theme.fgMuted} />}
                  chevron={false}
                  onPress={() => dismiss(() => run(message.id, () => actions.moveQueued(line, message, -1)))}
                />
              ) : null}
              {at < line.length - 1 ? (
                <ListRow
                  label={t("waitingDown")}
                  leading={<Icon name="ArrowDown" size={18} color={theme.fgMuted} />}
                  chevron={false}
                  onPress={() => dismiss(() => run(message.id, () => actions.moveQueued(line, message, 1)))}
                />
              ) : null}
              <ListRow
                label={t("waitingRemove")}
                leading={<Icon name="Trash2" size={18} color={theme.danger} />}
                chevron={false}
                onPress={() => dismiss(() => run(message.id, () => actions.unsend(message)))}
              />
            </>
          )}
        </BottomSheet>
      ) : null}
      {message && picked?.edit ? (
        <EditWaitingSheet message={message} actions={actions} onClose={() => setPicked(undefined)} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  tray: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingBottom: 4,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  title: { color: theme.fg, fontSize: 13, fontWeight: "600" },
  count: { color: theme.fgSubtle, fontSize: 12 },
  sub: { flex: 1, color: theme.fgSubtle, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 6 },
  textWrap: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  files: { flexDirection: "row", alignItems: "center", gap: 2 },
  text: { flex: 1, color: theme.fg, fontSize: 14 },
  act: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
}));
