import { useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import type { Thread } from "../hooks/useWorkspace";
import { t } from "../i18n";
import { Icon, type IconName } from "./Icon";
import { BottomSheet, Button, ListRow } from "./kit";
import { theme } from "./theme";

export type ThreadPatch = { title?: string | null; pinned?: boolean; archived?: boolean };

/** The chat's "…" sheet: rename, pin, archive or delete it, plus apps and switching chats. */
export function ChatMenu({
  thread,
  onClose,
  onApps,
  onSwitch,
  update,
  remove,
}: {
  thread: Thread;
  onClose: () => void;
  onApps: () => void;
  onSwitch: () => void;
  update: (patch: ThreadPatch) => Promise<void>;
  /** Deletes the chat; the screen leaves it. */
  remove: () => Promise<void>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(thread.title);
  const [busy, setBusy] = useState(false);
  const fail = (error: unknown) =>
    Alert.alert(t("couldNotChange"), error instanceof Error ? error.message : String(error));
  const act = (patch: ThreadPatch) => {
    onClose();
    void update(patch).catch(fail);
  };
  const item = (label: Parameters<typeof t>[0], icon: IconName, onPress: () => void, danger?: boolean) => (
    <ListRow
      label={t(label)}
      leading={<Icon name={icon} size={18} color={danger ? theme.danger : theme.fgMuted} />}
      chevron={false}
      onPress={onPress}
    />
  );
  if (renaming)
    return (
      <BottomSheet title={t("renameChat")} onClose={onClose}>
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
          <Button label={t("cancel")} variant="secondary" onPress={onClose} />
          <Button
            label={t("memSave")}
            busy={busy}
            disabled={!title.trim() || title.trim() === thread.title}
            onPress={() => {
              setBusy(true);
              update({ title: title.trim() })
                .then(onClose)
                .catch(fail)
                .finally(() => setBusy(false));
            }}
          />
        </View>
      </BottomSheet>
    );
  return (
    <BottomSheet onClose={onClose}>
      {item("renameChat", "Pencil", () => setRenaming(true))}
      {item(thread.pinned ? "unpinChat" : "pinChat", thread.pinned ? "PinOff" : "Pin", () =>
        act({ pinned: !thread.pinned }),
      )}
      {item(thread.archived ? "unarchiveChat" : "archiveChat", thread.archived ? "ArchiveRestore" : "Archive", () =>
        act({ archived: !thread.archived }),
      )}
      {item("apps", "LayoutGrid", () => {
        onClose();
        onApps();
      })}
      {item("switchChat", "MessageCircle", () => {
        onClose();
        onSwitch();
      })}
      {item(
        "deleteChat",
        "Trash2",
        () =>
          Alert.alert(t("deleteChat"), t("deleteChatAsk", { title: thread.title }), [
            { text: t("cancel"), style: "cancel" },
            {
              text: t("delete"),
              style: "destructive",
              onPress: () => {
                onClose();
                void remove().catch(fail);
              },
            },
          ]),
        true,
      )}
    </BottomSheet>
  );
}

const s = StyleSheet.create({
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
});
