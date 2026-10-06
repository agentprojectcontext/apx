import { Alert, StyleSheet, Text, View } from "react-native";
import type { Creds } from "../creds";
import { useNotifications } from "../hooks/useNotifications";
import { t as translate } from "../i18n";
import { Card, Muted, Page, PageHeader, RoundButton } from "../ui/components";
import { NotificationCard } from "../ui/NotificationCard";
import { theme as t } from "../ui/theme";

export function SettingsPage({ creds, back, disconnect }: { creds: Creds; back: () => void; disconnect: () => void }) {
  const notifications = useNotifications(creds);
  return (
    <View style={s.root}>
      <PageHeader title="Ajustes" back={back} />
      <Page>
        <NotificationCard status={notifications.status} enable={notifications.enable} />
        <Card style={s.connection}>
          <Text style={s.title}>{translate("serverAddress")}</Text>
          <Muted>{creds.url}</Muted>
          <RoundButton
            label={translate("disconnect")}
            secondary
            onPress={() =>
              Alert.alert(translate("disconnect"), "", [
                { text: translate("back"), style: "cancel" },
                { text: translate("disconnect"), style: "destructive", onPress: disconnect },
              ])
            }
          />
        </Card>
      </Page>
    </View>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  connection: { gap: 12, marginTop: 24 },
  title: { color: t.fg, fontSize: 14, fontWeight: "600" },
  error: { color: t.danger, fontSize: 12, marginTop: 10 },
});
