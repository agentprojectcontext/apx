import { Button, SettingRow, Skeleton, Switch } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { SubHead } from "./SectionHead.tsx";

type Privacy = { location: boolean; trips: boolean; revision: string };

export function PhonePrivacyBlock() {
  const t = useT();
  const section = useRef<HTMLElement>(null);
  const focus = useNav((s) => s.focus);
  useEffect(() => {
    if (focus !== "phone-privacy") return;
    section.current?.scrollIntoView({ block: "start" });
    section.current?.focus({ preventScroll: true });
    go.focus("");
  }, [focus]);
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
  return (
    <section className="config__privacy" ref={section} tabIndex={-1} aria-label={t("privacy.title")}>
      <SubHead>{t("privacy.title")}</SubHead>
      <p id="phone-privacy-scope" className="config__lead">
        {t("privacy.scope")}
      </p>
      {!value && !failed && <Skeleton width="100%" height={160} />}
      {failed && (
        <p role="alert" className="config__lead">
          {t("privacy.error")}{" "}
          <Button size="sm" variant="ghost" onClick={() => void read()}>
            {t("car.retry")}
          </Button>
        </p>
      )}
      {value && !failed && (
        <>
          <SettingRow title={t("privacy.location")} description={t("privacy.locationHelp")}>
            <Switch
              aria-label={t("privacy.location")}
              aria-describedby="phone-privacy-scope"
              checked={value.location}
              disabled={!value || busy || failed}
              onCheckedChange={(location) => void save({ location })}
            />
          </SettingRow>
          <SettingRow title={t("privacy.trips")} description={t("privacy.tripsHelp")}>
            <Switch
              aria-label={t("privacy.trips")}
              aria-describedby="phone-privacy-scope"
              checked={value.trips}
              disabled={!value || busy || failed}
              onCheckedChange={(trips) => void save({ trips })}
            />
          </SettingRow>
        </>
      )}
    </section>
  );
}
