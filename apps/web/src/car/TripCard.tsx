import type { CarAction, CarAlert, CarErrand, CarPlace, CarTripView } from "@apx/protocol";
import { Badge, Button, Card, Icons, Tag } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { currentLocale, type MessageKey, useT } from "../i18n/index.ts";
import { distanceText } from "./places.ts";
import { answerOffer, useCarTrip } from "./useCarTrip.ts";
import "./car.css";

const ANSWER_KEY: Record<CarAction, MessageKey> = {
  navigate: "car.answer.navigate",
  add_stop: "car.answer.add_stop",
  next: "car.answer.next",
  later: "car.answer.later",
  skip: "car.answer.skip",
  done: "car.answer.done",
  silence: "car.answer.silence",
};
/** The answers in the order a driver reaches for them; "no more this trip" goes apart, quieter. */
const ORDER: readonly CarAction[] = ["navigate", "add_stop", "next", "later", "skip", "done"];

/** Over the tasks list: only while a trip is on. */
export function CarTripCard() {
  const { view, reload } = useCarTrip();
  if (!view?.trip) return null;
  return <TripView view={view} onChanged={reload} />;
}

/** The trip: its waiting offers with their answers, then the open errands with the best place found for each. */
export function TripView({ view, onChanged }: { view: CarTripView; onChanged: () => void }) {
  const t = useT();
  const trip = view.trip;
  if (!trip) return null;
  const osm = view.alerts.some((a) => a.place.source === "osm") || view.errands.some((e) => e.best?.source === "osm");
  return (
    <Card
      variant="surface"
      padding="sm"
      className="cartrip"
      title={
        <span className="cartrip__head">
          <Icons.MapPin size={14} />
          {trip.destination?.label ? t("car.tripTo", { place: trip.destination.label }) : t("car.trip")}
        </span>
      }
      aside={
        trip.destination?.label ? (
          <Badge tone="brand" dot>
            {t("car.trip")}
          </Badge>
        ) : undefined
      }
    >
      {trip.silenced ? (
        <p className="cartrip__muted">{t("car.tripSilenced")}</p>
      ) : view.alerts.length ? (
        <div className="cartrip__offers">
          {view.alerts.map((a) => (
            <Offer key={a.id} alert={a} onAnswered={onChanged} />
          ))}
        </div>
      ) : (
        <p className="cartrip__muted">{t("car.tripNoOffers")}</p>
      )}
      <ErrandList errands={view.errands} onChanged={onChanged} />
      {osm && <p className="car__credit">{t("car.osmCredit")}</p>}
    </Card>
  );
}

/** Whether a place is open, when its source knows. */
function OpenChip({ place }: { place: CarPlace }) {
  const t = useT();
  if (place.closes_soon) return <Badge tone="warning">{t("car.closesSoon")}</Badge>;
  if (place.open === "open") return <Badge tone="brand">{t("car.open")}</Badge>;
  if (place.open === "closed") return <Badge tone="danger">{t("car.closed")}</Badge>;
  return null;
}

function Offer({ alert, onAnswered }: { alert: CarAlert; onAnswered: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<CarAction>();
  const [failed, setFailed] = useState(false);
  const answer = (action: CarAction) => {
    if (busy) return;
    setBusy(action);
    setFailed(false);
    answerOffer(alert, action).then(
      () => {
        setBusy(undefined);
        onAnswered();
      },
      () => {
        setBusy(undefined);
        setFailed(true);
      },
    );
  };
  const actions = ORDER.filter((a) => alert.actions.includes(a));
  return (
    <article className="cartrip__offer" aria-label={alert.errand}>
      <div className="cartrip__errand">{alert.errand}</div>
      <div className="cartrip__place">
        <span className="cartrip__placename">{alert.place.name}</span>
        <Tag icon={<Icons.MapPin size={11} />}>{alert.distance_label}</Tag>
        <OpenChip place={alert.place} />
      </div>
      {alert.place.address && <div className="cartrip__muted">{alert.place.address}</div>}
      <div className="cartrip__answers">
        {actions.map((a, i) => (
          <Button
            key={a}
            size="sm"
            variant={i === 0 ? "primary" : a === "done" ? "ghost" : "secondary"}
            loading={busy === a}
            disabled={Boolean(busy) && busy !== a}
            onClick={() => answer(a)}
          >
            {t(ANSWER_KEY[a])}
          </Button>
        ))}
      </div>
      {alert.actions.includes("silence") && (
        <Button
          size="sm"
          variant="link"
          className="cartrip__silence"
          disabled={Boolean(busy)}
          onClick={() => answer("silence")}
        >
          {t(ANSWER_KEY.silence)}
        </Button>
      )}
      {failed && (
        <p role="alert" className="cartrip__muted">
          {t("car.answerError")}
        </p>
      )}
    </article>
  );
}

function ErrandList({ errands, onChanged }: { errands: CarErrand[]; onChanged: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState<string>();
  const done = (e: CarErrand) => {
    setBusy(e.task_id);
    void client
      .call("car.errand", { task_id: e.task_id, action: "done" })
      .then(onChanged, () => {})
      .finally(() => setBusy(undefined));
  };
  return (
    <section className="cartrip__errands" aria-label={t("car.errands")}>
      <h4 className="cartrip__sub">{t("car.errands")}</h4>
      {errands.length ? (
        <ul className="car__list">
          {errands.map((e) => (
            <li key={e.task_id} className="car__row">
              <div className="car__rowmain">
                <span className="car__rowtitle">{e.title}</span>
                <ErrandWhere errand={e} />
              </div>
              <Button size="sm" variant="ghost" loading={busy === e.task_id} onClick={() => done(e)}>
                {t("car.errandDone")}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cartrip__muted">{t("car.errandsEmpty")}</p>
      )}
    </section>
  );
}

/** "Northwind Market · 900 m", or that nothing was found yet, and whether it waits. */
export function ErrandWhere({ errand }: { errand: CarErrand }) {
  const t = useT();
  return (
    <span className="car__rowmeta">
      {errand.best ? (
        <>
          <span>{errand.best.name}</span>
          {errand.distance_m != null && (
            <Tag icon={<Icons.MapPin size={11} />}>{distanceText(errand.distance_m, currentLocale())}</Tag>
          )}
          <OpenChip place={errand.best} />
        </>
      ) : (
        <span>{t("car.errandNoPlace")}</span>
      )}
      {errand.held && <Badge variant="outline">{t(errand.held === "skip" ? "car.held.skip" : "car.held.later")}</Badge>}
    </span>
  );
}
