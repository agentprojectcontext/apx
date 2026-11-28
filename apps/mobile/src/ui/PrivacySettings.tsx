import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Text } from "react-native";
import { t } from "../i18n";
import { Button, IconTile, ListGroup, ListRow, Toggle, useType } from "./kit";

type Privacy = { location: boolean; trips: boolean; revision: string };
type Stats = { enabled: boolean; usage: boolean | null };
type Call = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Same preferences as the computer, read from the paired core rather than copied into phone storage. */
export function PrivacySettings({ call }: { call: Call }) {
  const type = useType();
  const [privacy, setPrivacy] = useState<Privacy>();
  const [stats, setStats] = useState<Stats>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [statsFailed, setStatsFailed] = useState(false);
  const [permitted, setPermitted] = useState(false);
  const scope = useRef({ request: 0, busy: false, live: true });
  const reload = useCallback(async () => {
    if (scope.current.busy) return;
    const request = ++scope.current.request;
    const [p, s, os] = await Promise.allSettled([
      call("phone.privacy", {}),
      call("telemetry.get", {}),
      Location.getForegroundPermissionsAsync(),
    ]);
    if (!scope.current.live || request !== scope.current.request) return;
    if (p.status === "fulfilled") setPrivacy(p.value as Privacy);
    if (s.status === "fulfilled") setStats(s.value as Stats);
    setFailed(p.status === "rejected");
    setStatsFailed(s.status === "rejected");
    setPermitted(os.status === "fulfilled" && os.value?.granted === true);
  }, [call]);
  useEffect(() => {
    scope.current.live = true;
    void reload();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void reload();
    }, 3000);
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") void reload();
    });
    return () => {
      scope.current.live = false;
      scope.current.request++;
      clearInterval(timer);
      app.remove();
    };
  }, [reload]);
  const save = async (method: string, patch: Record<string, unknown>) => {
    if (scope.current.busy) return;
    scope.current.busy = true;
    scope.current.request++;
    setBusy(true);
    try {
      await call(method, patch);
    } catch (error) {
      if (scope.current.live) Alert.alert(t("couldNotChange"), String(error));
    } finally {
      scope.current.busy = false;
      if (scope.current.live) {
        setBusy(false);
        await reload();
      }
    }
  };
  const allow = async () => {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission && !permission.granted && !permission.canAskAgain) await Linking.openSettings();
      await reload();
    } catch (error) {
      Alert.alert(t("couldNotChange"), String(error));
    }
  };
  return (
    <>
      <Text style={type.rowTitle}>{t("privacyTitle")}</Text>
      <Text style={type.meta}>{t("privacyScope")}</Text>
      {failed || statsFailed ? (
        <>
          <Text style={type.muted}>{t("privacyUnavailable")}</Text>
          <Button label={t("privacyReload")} onPress={() => void reload()} />
        </>
      ) : null}
      <ListGroup>
        <ListRow
          wrap
          label={t("privacyLocation")}
          sub={t("privacyLocationHelp")}
          leading={<IconTile icon="MapPin" />}
          chevron={false}
          trailing={
            <Toggle
              label={t("privacyLocation")}
              value={privacy?.location ?? false}
              disabled={!privacy || busy || failed}
              onChange={(location) => void save("phone.configure_privacy", { location })}
            />
          }
        />
        <ListRow
          wrap
          label={t("privacyTrips")}
          sub={t("privacyTripsHelp")}
          leading={<IconTile icon="Car" />}
          chevron={false}
          trailing={
            <Toggle
              label={t("privacyTrips")}
              value={privacy?.trips ?? false}
              disabled={!privacy || busy || failed}
              onChange={(trips) => void save("phone.configure_privacy", { trips })}
            />
          }
        />
        <ListRow
          wrap
          label={t("privacyPermission")}
          sub={t("privacyPermissionHelp")}
          leading={<IconTile icon="MapPin" />}
          chevron={false}
          {...(permitted
            ? { detail: t("carReady") }
            : { trailing: <Button label={t("carAllow")} size="sm" onPress={() => void allow()} /> })}
        />
        <ListRow
          wrap
          label={t("privacyStats")}
          sub={t("privacyStatsHelp")}
          leading={<IconTile icon="Settings" />}
          chevron={false}
          trailing={
            <Toggle
              label={t("privacyStats")}
              value={stats?.usage === true}
              disabled={!stats?.enabled || busy || statsFailed}
              onChange={(usage) => void save("telemetry.set", { usage })}
            />
          }
        />
      </ListGroup>
    </>
  );
}
