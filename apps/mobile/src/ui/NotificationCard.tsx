import { Alert, Text, View } from "react-native";
import { t as translate } from "../i18n";
import { type NotificationStatus, notificationPreview, pushBuild } from "../notifications";
import { Icon } from "./Icon";
import { Button, Card, Spinner, useType } from "./kit";
import { makeStyles, useTheme } from "./theme";

export function NotificationCard({ status, enable }: { status: NotificationStatus; enable: () => Promise<void> }) {
  const type = useType();
  const t = useTheme();
  const s = useStyles();
  const enabled =
    status.state === "local" ||
    status.state === "push" ||
    status.state === "registering" ||
    Boolean(status.localEnabled);
  const busy = status.state === "checking" || status.state === "registering";
  return (
    <Card style={s.card}>
      <View style={s.heading}>
        <Icon name="Bell" size={18} color={enabled ? t.brand : t.fgMuted} />
        <Text style={s.title}>{translate("notifications")}</Text>
        {busy ? <Spinner size={14} /> : enabled ? <Icon name="Check" size={16} color={t.brand} /> : null}
      </View>
      <Text style={type.muted}>
        {translate(
          status.state === "push"
            ? status.via === "ntfy"
              ? "pushNtfy"
              : "pushActive"
            : status.state === "registering"
              ? "pushRegistering"
              : status.state === "local"
                ? "localActive"
                : status.state === "off"
                  ? "notificationsOff"
                  : status.state === "denied"
                    ? "notificationsDenied"
                    : status.state === "checking"
                      ? "notificationsChecking"
                      : "notificationsError",
        )}
      </Text>
      {/* Only a build without Firebase needs the ntfy route to reach the phone with APX closed. */}
      {status.state === "local" && !pushBuild() ? <Text style={type.meta}>{translate("pushPending")}</Text> : null}
      {status.state === "error" && status.detail ? (
        <Text selectable style={s.error}>
          {status.detail}
        </Text>
      ) : null}
      <View style={s.actions}>
        {enabled ? (
          <Button
            size="md"
            variant="secondary"
            label={translate("previewNotification")}
            onPress={() =>
              void notificationPreview().catch((error) => Alert.alert(translate("notifications"), String(error)))
            }
          />
        ) : null}
        {status.state === "off" || status.state === "denied" || status.state === "error" ? (
          <Button
            size="md"
            label={translate(
              status.state === "off" ? "turnOnNotifications" : status.state === "denied" ? "openSettings" : "retry",
            )}
            onPress={() => void enable()}
          />
        ) : null}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((t) => ({
  card: { gap: 8 },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { color: t.fg, fontSize: 15, fontWeight: "600", flex: 1 },
  error: { color: t.warning, fontSize: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 2 },
}));
