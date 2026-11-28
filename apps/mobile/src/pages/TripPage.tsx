import { useState } from "react";
import { Alert, Text, View } from "react-native";
import type { CarAction, CarAlert, CarTripView } from "../../../../packages/protocol/src/car.ts";
import { answersFor, distanceLabel } from "../car/model";
import { t } from "../i18n";
import { Button, Card, EmptyState, GroupLabel, ListGroup, ListRow, Screen, SubHeader, Tag, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

/** The trip in course: the errands offered near the way, each with its answers, then the other open errands. */
export function TripPage({
  view,
  answer,
  back,
}: {
  view: CarTripView | undefined;
  answer: (alertId: string, action: CarAction) => Promise<void>;
  back: () => void;
}) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const alerts = (view?.alerts ?? []).filter((alert) => !alert.answer);
  const offered = new Set(alerts.map((alert) => alert.task_id));
  const errands = (view?.errands ?? []).filter((errand) => !offered.has(errand.task_id));
  const osm =
    alerts.some((alert) => alert.place.source === "osm") || errands.some((errand) => errand.best?.source === "osm");
  return (
    <View style={s.page}>
      <SubHeader title={t("carTrip")} back={back} />
      {!view?.trip ? (
        <EmptyState title={t("carNoTrip")} body={t("carNoTripBody")} icon="Car" />
      ) : (
        <Screen gap={12}>
          {alerts.length ? (
            alerts.map((alert) => <Offer key={alert.id} alert={alert} answer={answer} />)
          ) : (
            <EmptyState title={t("carNothingNear")} body={t("carNothingNearBody")} icon="MapPin" />
          )}
          {errands.length ? (
            <>
              <GroupLabel label={`${t("carErrands")} · ${errands.length}`} color={theme.fgSubtle} inset={4} />
              <ListGroup>
                {errands.map((errand) => (
                  <ListRow
                    key={errand.task_id}
                    label={errand.title}
                    sub={
                      errand.held
                        ? t(errand.held === "later" ? "carAnswerLater" : "carAnswerSkip")
                        : (errand.best?.name ?? "")
                    }
                    {...(errand.distance_m != null && !errand.held ? { detail: distanceLabel(errand.distance_m) } : {})}
                    chevron={false}
                  />
                ))}
              </ListGroup>
            </>
          ) : null}
          {osm ? <Text style={[type.small, { textAlign: "center" }]}>{t("carOsmCredit")}</Text> : null}
        </Screen>
      )}
    </View>
  );
}

function Offer({ alert, answer }: { alert: CarAlert; answer: (id: string, action: CarAction) => Promise<void> }) {
  const type = useType();
  const s = useStyles();
  const [busy, setBusy] = useState<CarAction>();
  const pick = (action: CarAction) => {
    setBusy(action);
    answer(alert.id, action)
      .catch((error: unknown) => Alert.alert(alert.errand, error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(undefined));
  };
  return (
    <Card style={s.offer}>
      <View style={s.head}>
        <Text style={[type.rowTitle, { flex: 1 }]}>{alert.errand}</Text>
        <Tag tone="brand">{alert.distance_label}</Tag>
      </View>
      <Text style={type.muted}>{alert.place.name}</Text>
      {alert.place.address ? <Text style={type.meta}>{alert.place.address}</Text> : null}
      <View style={s.answers}>
        {answersFor(alert.actions).map((item, i) => (
          <Button
            key={item.action}
            label={t(item.label)}
            size="sm"
            variant={i === 0 ? "primary" : "secondary"}
            busy={busy === item.action}
            disabled={Boolean(busy)}
            onPress={() => pick(item.action)}
          />
        ))}
      </View>
    </Card>
  );
}

const useStyles = makeStyles((theme) => ({
  page: { flex: 1, backgroundColor: theme.bg },
  offer: { gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  answers: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 6 },
}));
