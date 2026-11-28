import type { PreferredPlace } from "@apx/protocol";
import { EmptyState, IconButton, Icons, SegmentedControl, Skeleton, Tag } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { categoryKey } from "./places.ts";

type Choice = "prefer" | "none" | "avoid";
const CHOICES: readonly Choice[] = ["prefer", "none", "avoid"];

/** "Places you use": what the owner chose before, to prefer, avoid or forget. */
export function CarPlaces() {
  const t = useT();
  const [places, setPlaces] = useState<PreferredPlace[]>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const load = () => {
    setFailed(false);
    void client.call("car.places", { limit: 100 }).then(
      (r) => setPlaces(r.places),
      () => setFailed(true),
    );
  };
  useEffect(load, []);
  const choose = (place: PreferredPlace, choice: Choice | "forget") => {
    setBusy(place.key);
    void client
      .call("car.place_choice", { key: place.key, choice })
      .then(
        (r) =>
          setPlaces((list) =>
            choice === "forget" || !r.place
              ? list?.filter((p) => p.key !== place.key)
              : list?.map((p) => (p.key === place.key && r.place ? r.place : p)),
          ),
        () => setFailed(true),
      )
      .finally(() => setBusy(undefined));
  };
  if (!places)
    return failed ? (
      <p role="alert" className="config__lead">
        {t("car.loadError")}
      </p>
    ) : (
      <Skeleton height={80} shape="block" />
    );
  if (!places.length)
    return (
      <EmptyState variant="dashed" size="sm" icon={<Icons.MapPin />} title={t("car.placesEmptyTitle")}>
        {t("car.placesEmpty")}
      </EmptyState>
    );
  return (
    <>
      <p className="config__lead">{t("car.placesHint")}</p>
      {failed && (
        <p role="alert" className="config__lead">
          {t("car.saveError")}
        </p>
      )}
      <ul className="car__list" aria-label={t("car.places")}>
        {places.map((p) => (
          <li key={p.key} className="car__row car__place">
            <div className="car__rowmain">
              <span className="car__rowtitle">{p.name}</span>
              <span className="car__rowmeta">
                {p.categories.slice(0, 3).map((c) => (
                  <Tag key={c}>{t(categoryKey(c))}</Tag>
                ))}
                {p.accepted > 0 && (
                  <span>{p.accepted === 1 ? t("car.wentOnce") : t("car.went", { n: p.accepted })}</span>
                )}
                {p.declined > 0 && <span>{t("car.skipped", { n: p.declined })}</span>}
              </span>
            </div>
            <div className="car__rowactions">
              <SegmentedControl
                size="sm"
                label={t("car.choice", { name: p.name })}
                value={p.choice ?? "none"}
                disabled={busy === p.key}
                options={CHOICES.map((c) => ({ value: c, label: t(`car.choice.${c}`) }))}
                onValueChange={(v) => {
                  const c = CHOICES.find((x) => x === v);
                  if (c && c !== (p.choice ?? "none")) choose(p, c);
                }}
              />
              <IconButton
                size="sm"
                variant="ghost"
                label={t("car.forget", { name: p.name })}
                disabled={busy === p.key}
                icon={<Icons.Trash2 size={14} />}
                onClick={() => choose(p, "forget")}
              />
            </div>
          </li>
        ))}
      </ul>
      {places.some((p) => p.key.startsWith("osm:")) && <p className="car__credit">{t("car.osmCredit")}</p>}
    </>
  );
}
