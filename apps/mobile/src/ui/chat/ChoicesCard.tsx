import { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Button } from "../kit";
import { makeStyles, useTheme } from "../theme";

type ChoicesPart = Extract<Message["parts"][number], { type: "choices" }>;
/** Sets the agent's personality, then says the pick in the chat. */
export type PickPersonality = (personality: string, said: string) => Promise<void>;

/** Answers the agent offers, while the chat is still on them: a pick (or the owner's own words) sets its personality. */
export function ChoicesCard({ part, pick }: { part: ChoicesPart; pick: PickPersonality }) {
  const theme = useTheme();
  const s = useStyles();
  const [own, setOwn] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const go = (key: string, personality: string, said: string) => {
    setBusy(key);
    pick(personality.slice(0, 1000), said)
      .catch((error: unknown) => Alert.alert(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(undefined));
  };
  return (
    <View style={s.card}>
      <View style={s.options}>
        {part.options.map((option) => (
          <Button
            key={option.label}
            size="sm"
            variant="secondary"
            label={option.label}
            busy={busy === option.label}
            disabled={Boolean(busy)}
            onPress={() => go(option.label, option.value, option.label)}
          />
        ))}
        {part.custom && own === undefined ? (
          <Button
            size="sm"
            variant="secondary"
            icon="Pencil"
            label={t("choicesOwn")}
            disabled={Boolean(busy)}
            onPress={() => setOwn("")}
          />
        ) : null}
      </View>
      {own !== undefined ? (
        <View style={s.reply}>
          <TextInput
            autoFocus
            value={own}
            maxLength={1000}
            onChangeText={setOwn}
            placeholder={t("choicesOwnPlaceholder")}
            placeholderTextColor={theme.fgSubtle}
            multiline
            style={s.input}
          />
          <Button
            size="md"
            label={t("send")}
            busy={busy === "own"}
            disabled={Boolean(busy) || !own.trim()}
            onPress={() => go("own", own.trim(), own.trim())}
          />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: { alignSelf: "stretch", gap: 10 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  reply: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  input: {
    flex: 1,
    minHeight: 36,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: theme.fill,
    color: theme.fg,
    fontSize: 14,
  },
}));
