// What the owner said that asked for a task or changed it, word for word and to whom (Task.asked).
import { useState } from "react";
import { Text, View } from "react-native";
import { ago } from "../format";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { Button, Card, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

/** How many of the owner's messages show before "Show all": the newest. */
const SHOWN = 3;

export type Asked = { text: string; at: string; by: string; message_id?: string };

export function TaskAsked({ asked, agentName }: { asked: Asked[]; agentName: (id: string) => string }) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [all, setAll] = useState(false);
  if (!asked.length) return null;
  const shown = all ? asked : asked.slice(-SHOWN);
  return (
    <Card style={s.card}>
      <View style={s.head}>
        <Icon name="Quote" size={13} color={theme.fgMuted} />
        <Text style={[type.meta, { flex: 1 }]}>{t("tkAsked")}</Text>
      </View>
      {shown.map((said) => (
        <View key={`${said.at}-${said.message_id ?? said.text.slice(0, 20)}`} style={s.said}>
          <Text style={s.words}>{said.text}</Text>
          <Text style={type.meta}>{t("tkAskedTo", { when: ago(said.at), agent: agentName(said.by) })}</Text>
        </View>
      ))}
      {asked.length > shown.length ? (
        <Button
          label={t("tkAskedAll", { n: asked.length })}
          size="sm"
          variant="secondary"
          style={s.more}
          onPress={() => setAll(true)}
        />
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles((theme) => ({
  card: { gap: 8, paddingTop: 4 },
  head: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 32, paddingLeft: 4 },
  said: { gap: 2, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: theme.borderStrong },
  words: { color: theme.fg, fontSize: 15, lineHeight: 21 },
  more: { alignSelf: "flex-start" },
}));
