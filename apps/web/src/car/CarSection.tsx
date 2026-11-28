import type { CarReach, CarSettings, CarStatus } from "@apx/protocol";
import { Badge, Button, Input, SegmentedControl, SettingRow, Skeleton, Switch } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHead, SubHead } from "../config/SectionHead.tsx";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { CarPlaces } from "./CarPlaces.tsx";
import { CarPreview } from "./CarPreview.tsx";
import { TripView } from "./TripCard.tsx";
import { useCarTrip } from "./useCarTrip.ts";
import "./car.css";

const REACHES: readonly CarReach[] = ["near", "normal", "far"];

/** Settings › In the car: on or off, how far ahead, where places come from, and the phone that reports the trips. */
export function CarSection() {
  const t = useT();
  const [status, setStatus] = useState<CarStatus>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const gate = useRef({ request: 0, busy: false, live: true });
  const load = useCallback(() => {
    if (gate.current.busy) return;
    const request = ++gate.current.request;
    void client.call("car.settings", {}).then(
      (value) => {
        if (!gate.current.live || request !== gate.current.request) return;
        setStatus(value);
        setLoadFailed(false);
      },
      () => {
        if (gate.current.live && request === gate.current.request) setLoadFailed(true);
      },
    );
  }, []);
  useEffect(() => {
    gate.current.live = true;
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 3000);
    return () => {
      gate.current.live = false;
      gate.current.request++;
      clearInterval(timer);
    };
  }, [load]);
  const save = async (change: Partial<CarSettings> & { google_key?: string }): Promise<boolean> => {
    if (gate.current.busy) return false;
    gate.current.busy = true;
    gate.current.request++;
    setBusy(true);
    setSaveFailed(false);
    try {
      setStatus(await client.call("car.configure", change));
      return true;
    } catch {
      setSaveFailed(true);
      return false;
    } finally {
      gate.current.busy = false;
      if (gate.current.live) setBusy(false);
    }
  };
  const head = <SectionHead title={t("car.title")} lead={t("car.lead")} />;
  if (!status)
    return (
      <>
        {head}
        {loadFailed ? (
          <>
            <p role="alert" className="config__lead">
              {t("car.loadError")}
            </p>
            <Button variant="secondary" onClick={load}>
              {t("car.retry")}
            </Button>
          </>
        ) : (
          <Skeleton height={240} shape="block" />
        )}
      </>
    );
  const s = status.settings;
  return (
    <>
      {head}
      {loadFailed && (
        <p role="alert" className="config__lead">
          {t("car.loadError")}
        </p>
      )}
      <p id="car-global-scope" className="config__lead">
        {t("car.enabledHint")}
      </p>
      <SettingRow title={t("car.enabled")}>
        <Switch
          size="sm"
          aria-label={t("car.enabled")}
          aria-describedby="car-global-scope"
          checked={s.enabled}
          disabled={busy || loadFailed}
          onCheckedChange={(enabled) => void save({ enabled })}
        />
      </SettingRow>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          go.focus("phone-privacy");
          go.config("advanced");
        }}
      >
        {t("car.manageLocation")}
      </Button>
      {saveFailed && (
        <p role="alert" className="config__lead">
          {t("car.saveError")}
        </p>
      )}
      {s.enabled && (
        <>
          <SettingRow title={t("car.reach")} description={t("car.reachHint")}>
            <SegmentedControl
              size="sm"
              label={t("car.reach")}
              value={s.reach}
              disabled={busy}
              options={REACHES.map((r) => ({ value: r, label: t(`car.reach.${r}`) }))}
              onValueChange={(v) => {
                const reach = REACHES.find((r) => r === v);
                if (reach && reach !== s.reach) void save({ reach });
              }}
            />
          </SettingRow>
          <PlaceSource status={status} busy={busy} save={save} />
          <SettingRow title={t("car.tellInChat")} description={t("car.tellInChatHint")}>
            <Switch
              size="sm"
              aria-label={t("car.tellInChat")}
              checked={s.tell_in_chat}
              disabled={busy}
              onCheckedChange={(tell_in_chat) => void save({ tell_in_chat })}
            />
          </SettingRow>
          <SettingRow title={t("car.voice")} description={t("car.voiceHint")}>
            <Switch
              size="sm"
              aria-label={t("car.voice")}
              checked={s.voice_while_driving}
              disabled={busy}
              onCheckedChange={(voice_while_driving) => void save({ voice_while_driving })}
            />
          </SettingRow>
          <CarPreview />
          <CurrentTrip />
        </>
      )}
      <SubHead>{t("car.places")}</SubHead>
      <CarPlaces />
    </>
  );
}

/** OpenStreetMap, free; or Google with the owner's key, which is saved and never shown again. */
function PlaceSource({
  status,
  busy,
  save,
}: {
  status: CarStatus;
  busy: boolean;
  save: (change: Partial<CarSettings> & { google_key?: string }) => Promise<boolean>;
}) {
  const t = useT();
  const [wantGoogle, setWantGoogle] = useState(false);
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");
  const google = status.settings.source === "google" || wantGoogle;
  const askKey = google && (!status.google_key || editing);
  const saveKey = async () => {
    if (await save({ google_key: key.trim(), source: "google" })) {
      setKey("");
      setEditing(false);
      setWantGoogle(false);
    }
  };
  return (
    <>
      <SettingRow title={t("car.source")} description={t("car.sourceHint")}>
        <SegmentedControl
          size="sm"
          label={t("car.source")}
          value={google ? "google" : "osm"}
          disabled={busy}
          options={[
            { value: "osm", label: t("car.source.osm") },
            { value: "google", label: t("car.source.google") },
          ]}
          onValueChange={(v) => {
            if (v === "osm") {
              setWantGoogle(false);
              setEditing(false);
              if (status.settings.source !== "osm") void save({ source: "osm" });
            } else if (status.google_key) void save({ source: "google" });
            else setWantGoogle(true);
          }}
        />
      </SettingRow>
      {google && (
        <SettingRow stacked={askKey} title={t("car.googleKey")} description={t("car.googleKeyHint")}>
          {askKey ? (
            <form
              className="car__keyform"
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim()) void saveKey();
              }}
            >
              <Input
                size="sm"
                type="password"
                autoComplete="off"
                aria-label={t("car.googleKey")}
                placeholder={t("car.googleKeyPlaceholder")}
                value={key}
                onChange={(e) => setKey(e.currentTarget.value)}
              />
              <Button size="sm" type="submit" disabled={!key.trim() || busy} loading={busy}>
                {t("car.googleKeySave")}
              </Button>
              {status.google_key && (
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </Button>
              )}
            </form>
          ) : (
            <div className="car__inline">
              <Badge tone="brand" dot>
                {t("car.googleKeySaved")}
              </Badge>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                {t("car.googleKeyChange")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void save({ google_key: "", source: "osm" })}
              >
                {t("car.googleKeyRemove")}
              </Button>
            </div>
          )}
        </SettingRow>
      )}
      {wantGoogle && !status.google_key && <p className="config__lead">{t("car.googleNeedsKey")}</p>}
    </>
  );
}

/** The trip under way, if any: the same card the tasks list shows while driving. */
function CurrentTrip() {
  const { view, reload } = useCarTrip();
  if (!view?.trip) return null;
  return <TripView view={view} onChanged={reload} />;
}
