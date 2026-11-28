import { Button, SettingRow, Skeleton, Switch } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

type Privacy = { location: boolean; trips: boolean; revision: string };

export function PhonePrivacyBlock() {
  const t = useT();
  const [value, setValue] = useState<Privacy>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const scope = useRef({ request: 0, busy: false, live: true });
  const read = useCallback(async () => {
    if (scope.current.busy) return;
    const request = ++scope.current.request;
    try {
      const value = await client.call("phone.privacy", {});
      if (!scope.current.live || request !== scope.current.request) return;
      setValue(value);
      setFailed(false);
    } catch {
      if (scope.current.live && request === scope.current.request) setFailed(true);
    }
  }, []);
  useEffect(() => {
    scope.current.live = true;
    void read();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void read();
    }, 3000);
    return () => {
      scope.current.live = false;
      scope.current.request++;
      clearInterval(timer);
    };
  }, [read]);
  const save = async (patch: { location?: boolean; trips?: boolean }) => {
    if (scope.current.busy) return;
    scope.current.busy = true;
    scope.current.request++;
    setBusy(true);
    try {
      const value = await client.call("phone.configure_privacy", patch);
      if (scope.current.live) {
        setValue(value);
        setFailed(false);
      }
    } catch {
      if (scope.current.live) setFailed(true);
    } finally {
      scope.current.busy = false;
      if (scope.current.live) setBusy(false);
    }
  };
  if (!value && !failed) return <Skeleton width="100%" height={160} />;
  return (
    <>
      <SubHead>{t("privacy.title")}</SubHead>
      <p className="config__lead">{t("privacy.scope")}</p>
      {failed && (
        <p role="alert" className="config__lead">
          {t("privacy.error")}{" "}
          <Button size="sm" variant="ghost" onClick={() => void read()}>
            {t("car.retry")}
          </Button>
        </p>
      )}
      <SettingRow title={t("privacy.location")} description={t("privacy.locationHelp")}>
        <Switch
          aria-label={t("privacy.location")}
          checked={value?.location ?? false}
          disabled={!value || busy || failed}
          onCheckedChange={(location) => void save({ location })}
        />
      </SettingRow>
      <SettingRow title={t("privacy.trips")} description={t("privacy.tripsHelp")}>
        <Switch
          aria-label={t("privacy.trips")}
          checked={value?.trips ?? false}
          disabled={!value || busy || failed}
          onCheckedChange={(trips) => void save({ trips })}
        />
      </SettingRow>
    </>
  );
}
