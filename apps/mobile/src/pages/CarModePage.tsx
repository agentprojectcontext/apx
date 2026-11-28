import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, Linking, Text, View } from "react-native";
import type { CarStatus } from "../../../../packages/protocol/src/car.ts";
import { useCarNative } from "../car/hooks";
import { type CheckItem, checklist, statusLine } from "../car/model";
import { type CarNativeStatus, carNative } from "../car/native";
import { saveCarEnabled, useCarEnabled } from "../car/prefs";
import type { Creds } from "../creds";
import { ago } from "../format";
import { useNotifications } from "../hooks/useNotifications";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import {
  Button,
  Card,
  Dot,
  GroupLabel,
  IconTile,
  ListGroup,
  ListRow,
  Screen,
  SubHeader,
  Toggle,
  useType,
} from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

type Call = (method: string, params: Record<string, unknown>) => Promise<unknown>;

/** Global errands and this phone's participation are separate, explicit choices. */
export function CarModePage({ creds, call, back }: { creds: Creds; call: Call; back: () => void }) {
  const s = useStyles();
  if (!carNative.available)
    return (
      <View style={s.page}>
        <SubHeader title={t("carMode")} back={back} />
        <Screen>
          <Text style={[s.muted, s.inset]}>{t("carUnavailable")}</Text>
        </Screen>
      </View>
    );
  return <CarModeSettings creds={creds} call={call} back={back} />;
}

function CarModeSettings({ creds, call, back }: { creds: Creds; call: Call; back: () => void }) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const enabled = useCarEnabled() ?? false;
  const { status, refresh } = useCarNative();
  const notifications = useNotifications(creds);
  const [core, setCore] = useState<CarStatus>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const gate = useRef({ request: 0, busy: false, live: true });
  const readCore = useCallback(() => {
    if (gate.current.busy) return;
    const request = ++gate.current.request;
    void (call("car.settings", {}) as Promise<CarStatus>).then(
      (value) => {
        if (!gate.current.live || request !== gate.current.request) return;
        setCore(value);
        setFailed(false);
      },
      () => {
        if (gate.current.live && request === gate.current.request) setFailed(true);
      },
    );
  }, [call]);
  useEffect(() => {
    gate.current.live = true;
    readCore();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") readCore();
    }, 3000);
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") readCore();
    });
    return () => {
      gate.current.live = false;
      gate.current.request++;
      clearInterval(timer);
      app.remove();
    };
  }, [readCore]);
  const turn = async (on: boolean) => {
    if (gate.current.busy) return;
    gate.current.busy = true;
    gate.current.request++;
    setBusy(true);
    try {
      if (on) {
        const now = (await call("car.settings", {})) as CarStatus;
        setCore(now);
        if (!now.settings.enabled) {
          Alert.alert(t("carMode"), t("carCoreOff"));
          return;
        }
        await carNative.allowTrips();
      } else {
        await carNative.pauseTrips();
      }
      await saveCarEnabled(on);
    } catch (error) {
      Alert.alert(t("couldNotChange"), error instanceof Error ? error.message : String(error));
    } finally {
      gate.current.busy = false;
      if (gate.current.live) setBusy(false);
    }
  };
  const coreOn = async (enabled = true) => {
    if (gate.current.busy) return;
    gate.current.busy = true;
    gate.current.request++;
    setBusy(true);
    try {
      setCore((await call("car.configure", { enabled })) as CarStatus);
    } catch (error) {
      Alert.alert(t("couldNotChange"), error instanceof Error ? error.message : String(error));
    } finally {
      gate.current.busy = false;
      if (gate.current.live) setBusy(false);
    }
  };
  const allow = async (item: CheckItem["id"]) => {
    if (item === "listener") await carNative.openListenerSettings().catch(() => undefined);
    if (item === "location") {
      const perm = await Location.requestForegroundPermissionsAsync().catch(() => undefined);
      if (perm && !perm.granted && !perm.canAskAgain) await Linking.openSettings().catch(() => undefined);
    }
    if (item === "notifications") await notifications.enable().catch(() => undefined);
    refresh();
  };
  const line = status ? statusLine(status) : undefined;
  const testing = status?.trip?.source === "manual";
  return (
    <View style={s.page}>
      <SubHeader title={t("carMode")} back={back} />
      <Screen gap={12}>
        <ListGroup>
          <ListRow
            label={t("carGlobal")}
            sub={t("carGlobalHelp")}
            leading={<IconTile icon="Car" />}
            chevron={false}
            trailing={
              <Toggle
                label={t("carGlobal")}
                value={core?.settings.enabled ?? false}
                disabled={!core || busy || failed}
                onChange={(on) => void coreOn(on)}
              />
            }
          />
          <ListRow
            label={t("carSwitch")}
            sub={t("carSwitchHelp")}
            leading={<IconTile icon="Car" tone={enabled ? "brand" : "neutral"} />}
            trailing={
              <Toggle value={enabled} label={t("carSwitch")} disabled={busy} onChange={(on) => void turn(on)} />
            }
            chevron={false}
          />
        </ListGroup>
        {failed ? <Text style={s.error}>{t("privacyUnavailable")}</Text> : null}
        {enabled && core && !core.settings.enabled ? <Text style={type.muted}>{t("carCoreOff")}</Text> : null}
        {enabled && status ? (
          <>
            {line ? <StatusCard status={status} line={line} /> : null}
            <GroupLabel label={t("carNeeds")} color={theme.fgSubtle} inset={4} />
            <ListGroup>
              {checklist(status).map((item) => (
                <ListRow
                  key={item.id}
                  label={t(item.label)}
                  sub={t(item.help)}
                  leading={
                    <IconTile
                      icon={item.id === "listener" ? "Bell" : item.id === "location" ? "MapPin" : "MessageSquare"}
                      tone={item.done ? "brand" : "neutral"}
                    />
                  }
                  trailing={
                    item.done ? (
                      <Icon name="Check" size={16} color={theme.brand} />
                    ) : (
                      <Button label={t("carAllow")} size="sm" onPress={() => void allow(item.id)} />
                    )
                  }
                  {...(item.done ? { detail: t("carReady") } : {})}
                  chevron={false}
                />
              ))}
            </ListGroup>
            <Button
              label={t(testing ? "carTestStop" : "carTest")}
              variant="secondary"
              icon={testing ? "Square" : "Play"}
              disabled={Boolean(status.trip && !testing)}
              style={{ alignSelf: "stretch" }}
              onPress={() =>
                void (testing ? carNative.stopTestTrip() : carNative.startTestTrip())
                  .catch((error: unknown) => Alert.alert(t("carTest"), String(error)))
                  .finally(refresh)
              }
            />
            <Text style={[type.meta, s.inset]}>{t("carTestHelp")}</Text>
            <Text style={[type.meta, s.inset]}>{t("carAutoNote")}</Text>
          </>
        ) : null}
      </Screen>
    </View>
  );
}

function StatusCard({ status, line }: { status: CarNativeStatus; line: NonNullable<ReturnType<typeof statusLine>> }) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const color = line.tone === "brand" ? theme.brand : line.tone === "warning" ? theme.warning : theme.fgSubtle;
  return (
    <Card style={s.status}>
      <View style={s.row}>
        <Dot color={color} />
        <Text style={[type.rowTitle, { flex: 1 }]}>{t(line.key)}</Text>
      </View>
      {line.sent ? <Text style={type.meta}>{t("carLastSent", { when: ago(line.sent) })}</Text> : null}
      {status.last_error ? <Text style={s.error}>{status.last_error}</Text> : null}
    </Card>
  );
}

const useStyles = makeStyles((theme) => ({
  page: { flex: 1, backgroundColor: theme.bg },
  inset: { paddingHorizontal: 4 },
  muted: { color: theme.fgMuted, fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  status: { gap: 4 },
  error: { color: theme.warning, fontSize: 12 },
}));
