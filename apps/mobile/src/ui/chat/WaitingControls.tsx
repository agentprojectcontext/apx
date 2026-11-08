// The owner's words their agent has not taken yet: "Send now" and "Remove" under one sent while it works, and for
// one in line for its next turn also edit and move, all in sight (a phone has no hover).
import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { wordsOf } from "../../chat/waiting";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon } from "../Icon";
import { BottomSheet, Button, IconButton } from "../kit";
import { makeStyles, useTheme } from "../theme";

export type WaitingActions = {
  sendNow: (message: Message) => Promise<void>;
  unsend: (message: Message) => Promise<void>;
  editQueued: (message: Message, text: string) => Promise<boolean>;
  moveQueued: (line: Message[], message: Message, by: -1 | 1) => Promise<void>;
};

const seenWaiting = new Set<string>();

/** Whether the agent has taken a message the owner saw waiting: it then reads "Now", as a chat app marks one read. */
export function useTaken(message: Message): boolean {
  if (message.waiting) seenWaiting.add(message.id);
  return !message.waiting && seenWaiting.has(message.id);
}

export function TakenMark() {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.taken}>
      <Icon name="CheckCheck" size={12} color={theme.brand} />
      <Text style={s.takenText}>{t("waitingTaken")}</Text>
    </View>
  );
}

/** Under a waiting message of the owner's; `line` is set when it waits in line, so it can be edited and moved. */
export function WaitingControls({
  message,
  actions,
  line,
}: {
  message: Message;
  actions: WaitingActions;
  line?: Message[];
}) {
  const theme = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<string>();
  const at = line?.findIndex((one) => one.id === message.id) ?? -1;
  const run = (job: () => Promise<unknown>) => {
    setBusy(true);
    void job().finally(() => setBusy(false));
  };
  return (
    <View style={s.row}>
      <Button
        label={t("waitingSendNow")}
        icon="Zap"
        size="sm"
        variant="secondary"
        busy={busy}
        onPress={() => run(() => actions.sendNow(message))}
      />
      {line ? (
        <IconButton icon="Pencil" size={16} label={t("waitingEdit")} onPress={() => setDraft(wordsOf(message))} />
      ) : null}
      {line && line.length > 1 ? (
        <>
          {at > 0 ? (
            <IconButton
              icon="ArrowUp"
              size={16}
              label={t("waitingUp")}
              onPress={() => run(() => actions.moveQueued(line, message, -1))}
            />
          ) : null}
          {at < line.length - 1 ? (
            <IconButton
              icon="ArrowDown"
              size={16}
              label={t("waitingDown")}
              onPress={() => run(() => actions.moveQueued(line, message, 1))}
            />
          ) : null}
        </>
      ) : null}
      <IconButton
        icon="Trash2"
        size={16}
        color={theme.fgMuted}
        label={t("waitingRemove")}
        onPress={() => run(() => actions.unsend(message))}
      />
      {draft !== undefined ? (
        <BottomSheet title={t("waitingEdit")} onClose={() => setDraft(undefined)}>
          {(dismiss) => (
            <View style={s.editing}>
              <TextInput
                autoFocus
                multiline
                value={draft}
                onChangeText={setDraft}
                accessibilityLabel={t("waitingEdit")}
                placeholderTextColor={theme.fgSubtle}
                style={s.input}
              />
              <View style={s.editActions}>
                <Button label={t("cancel")} variant="secondary" size="sm" onPress={() => dismiss()} />
                <Button
                  label={t("save")}
                  size="sm"
                  disabled={!draft.trim() || draft.trim() === wordsOf(message).trim()}
                  onPress={() =>
                    void actions.editQueued(message, draft.trim()).then((saved) => {
                      if (saved) dismiss();
                    })
                  }
                />
              </View>
            </View>
          )}
        </BottomSheet>
      ) : null}
    </View>
  );
}

/** The label over the messages in line for the agent's next turn. */
export function LineLabel({ name }: { name: string }) {
  const theme = useTheme();
  const s = useStyles();
  return (
    <View style={s.label}>
      <Icon name="Clock" size={12} color={theme.fgSubtle} />
      <Text style={s.labelText}>{t("waitingLine", { name })}</Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  taken: { flexDirection: "row", alignItems: "center", gap: 3 },
  takenText: { color: theme.brand, fontSize: 11 },
  label: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end", paddingRight: 6, paddingTop: 6 },
  labelText: { color: theme.fgSubtle, fontSize: 12 },
  editing: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  input: {
    minHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    color: theme.fg,
    fontSize: 15,
    backgroundColor: theme.fill,
    textAlignVertical: "top",
  },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
}));
