import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import type { Thread } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { Icon, type IconName } from "./Icon";
import { BottomSheet, Button, ListRow, type SheetDismiss } from "./kit";
import { makeStyles, useTheme } from "./theme";

export type ThreadPatch = { title?: string | null; pinned?: boolean; archived?: boolean };

/**
 * A chat's sheet: rename, pin, archive or delete it. From the open chat ("…") it also offers apps and switching chats;
 * from a list (a long press) marking it read.
 */
export function ChatMenu({
  thread,
  onClose,
  onApps,
  onSwitch,
  onRead,
  update,
  remove,
}: {
  thread: Thread;
  onClose: () => void;
  onApps?: () => void;
  onSwitch?: () => void;
  /** Marks it read; offered only while it has unread messages. */
  onRead?: () => Promise<void>;
  update: (patch: ThreadPatch) => Promise<void>;
  /** Deletes the chat; the screen leaves it. */
  remove: () => Promise<void>;
}) {
  const theme = useTheme();
  const s = useStyles();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const fail = (error: unknown) =>
    Alert.alert(t("couldNotChange"), error instanceof Error ? error.message : String(error));
  const item = (label: Parameters<typeof t>[0], icon: IconName, onPress: () => void, danger?: boolean) => (
    <ListRow
      key={label}
      label={t(label)}
      leading={<Icon name={icon} size={18} color={danger ? theme.danger : theme.fgMuted} />}
      chevron={false}
      onPress={onPress}
    />
  );
  if (renaming)
    return (
      <BottomSheet title={t("renameChat")} onClose={onClose}>
        {(dismiss) => (
          <>
            <TextInput
              autoFocus
              value={title}
              onChangeText={setTitle}
              maxLength={200}
              returnKeyType="done"
              placeholder={thread.title}
              placeholderTextColor={theme.fgSubtle}
              style={s.input}
            />
            <View style={s.actions}>
              <Button label={t("cancel")} variant="secondary" onPress={() => dismiss()} />
              <Button
                label={t("memSave")}
                busy={busy}
                disabled={!title.trim() || title.trim() === thread.title}
                onPress={() => {
                  setBusy(true);
                  update({ title: title.trim() })
                    .then(() => dismiss())
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              />
            </View>
          </>
        )}
      </BottomSheet>
    );
  const menu = (dismiss: SheetDismiss) => {
    const act = (patch: ThreadPatch) => dismiss(() => void update(patch).catch(fail));
    return [
      onRead && thread.unread > 0
        ? item("markRead", "CheckCheck", () => dismiss(() => void onRead().catch(fail)))
        : null,
      item("renameChat", "Pencil", () => setRenaming(true)),
      item(thread.pinned ? "unpinChat" : "pinChat", thread.pinned ? "PinOff" : "Pin", () =>
        act({ pinned: !thread.pinned }),
      ),
      thread.kind === "home"
        ? null
        : item(thread.archived ? "unarchiveChat" : "archiveChat", thread.archived ? "ArchiveRestore" : "Archive", () =>
            act({ archived: !thread.archived }),
          ),
      onApps ? item("apps", "LayoutGrid", () => dismiss(onApps)) : null,
      onSwitch ? item("switchChat", "MessageCircle", () => dismiss(onSwitch)) : null,
      thread.kind === "home"
        ? null
        : item(
            "deleteChat",
            "Trash2",
            () =>
              Alert.alert(t("deleteChat"), t("deleteChatAsk", { title: thread.title }), [
                { text: t("cancel"), style: "cancel" },
                {
                  text: t("delete"),
                  style: "destructive",
                  onPress: () => dismiss(() => void remove().catch(fail)),
                },
              ]),
            true,
          ),
    ];
  };
  return (
    <BottomSheet title={thread.title} onClose={onClose}>
      {menu}
    </BottomSheet>
  );
}

const useStyles = makeStyles((theme) => ({
  input: {
    height: 48,
    margin: 4,
    paddingHorizontal: 16,
    borderRadius: 16,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 16,
  },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, padding: 8 },
}));
