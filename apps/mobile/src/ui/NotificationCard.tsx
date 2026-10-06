import { Alert, StyleSheet, Text, View } from "react-native";
import { t as translate } from "../i18n";
import { type NotificationStatus, notificationPreview } from "../notifications";
import { Card, Muted, RoundButton } from "./components";
import { Icon } from "./Icon";
import { theme as t } from "./theme";

export function NotificationCard({ status, enable }: { status: NotificationStatus; enable: () => Promise<void> }) {
  const enabled = status.state === "local" || status.state === "push" || Boolean(status.localEnabled);
  return (
    <Card style={s.card}>
      <View style={s.heading}>
        <Icon name="Bell" size={19} color={enabled ? t.brand : t.muted} />
        <Text style={s.title}>{translate("notifications")}</Text>
        {enabled ? <Icon name="Check" size={16} color={t.brand} /> : null}
      </View>
      <Muted>
        {translate(
          status.state === "push"
            ? "pushActive"
            : status.state === "local"
              ? "localActive"
              : status.state === "denied"
                ? "notificationsDenied"
                : status.state === "checking"
                  ? "notificationsChecking"
                  : "notificationsError",
        )}
      </Muted>
      {status.state === "local" ? <Muted>{translate("pushPending")}</Muted> : null}
      {status.state === "push" ? <Muted>{translate("pushDestination")}</Muted> : null}
      {enabled ? (
        <RoundButton
          label={translate("previewNotification")}
          onPress={() =>
            void notificationPreview().catch((error) => Alert.alert(translate("notifications"), String(error)))
          }
          secondary
        />
      ) : null}
      {status.state === "error" && status.detail ? (
        <Text selectable style={s.error}>
          {status.detail}
        </Text>
      ) : null}
      {status.state === "denied" || status.state === "error" ? (
        <RoundButton
          label={translate(status.state === "denied" ? "openSettings" : "retry")}
          onPress={() => void enable()}
          secondary
        />
      ) : null}
    </Card>
  );
}
const s = StyleSheet.create({
  card: { gap: 8, marginTop: 20 },
  heading: { flexDirection: "row", alignItems: "center", gap: 9 },
  title: { color: t.fg, fontSize: 14, fontWeight: "600", flex: 1 },
  error: { color: t.warning, fontSize: 12 },
});
