import type { CarErrand } from "@apx/protocol";
import { Button, Icons, SettingRow } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { ErrandWhere } from "./TripCard.tsx";

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "denied" }
  | { kind: "failed" }
  | { kind: "done"; errands: CarErrand[] };

/** Where the browser is now (asked only on the click), never kept. */
function here(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 15_000 }),
  );
}

/** "Try it here": what each open errand would be offered from where the owner is, so they can check without driving. */
export function CarPreview() {
  const t = useT();
  const [state, setState] = useState<State>({ kind: "idle" });
  const run = async () => {
    setState({ kind: "busy" });
    let pos: GeolocationPosition;
    try {
      pos = await here();
    } catch {
      setState({ kind: "denied" });
      return;
    }
    try {
      const { errands } = await client.call("car.preview", {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      });
      setState({ kind: "done", errands });
    } catch {
      setState({ kind: "failed" });
    }
  };
  const osm = state.kind === "done" && state.errands.some((e) => e.best?.source === "osm");
  return (
    <>
      <SettingRow title={t("car.preview")} description={t("car.previewHint")}>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.MapPin size={14} />}
          loading={state.kind === "busy"}
          disabled={!("geolocation" in navigator)}
          onClick={() => void run()}
        >
          {t("car.previewRun")}
        </Button>
      </SettingRow>
      {(state.kind === "denied" || state.kind === "failed") && (
        <p role="alert" className="config__lead">
          {t(state.kind === "denied" ? "car.previewDenied" : "car.previewError")}
        </p>
      )}
      {state.kind === "done" &&
        (state.errands.length ? (
          <ul className="car__list car__preview" aria-label={t("car.preview")}>
            {state.errands.map((e) => (
              <li key={e.task_id} className="car__row">
                <div className="car__rowmain">
                  <span className="car__rowtitle">{e.title}</span>
                  {e.best ? (
                    <ErrandWhere errand={e} />
                  ) : (
                    <span className="car__rowmeta">{t("car.previewNothing")}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="config__lead">{t("car.previewEmpty")}</p>
        ))}
      {osm && <p className="car__credit">{t("car.osmCredit")}</p>}
    </>
  );
}
