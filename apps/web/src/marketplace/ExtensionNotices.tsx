import type { ExtensionInfo } from "@apx/protocol";
import { Button, Field, Input, Select, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { useT } from "../i18n/index.ts";

const clock = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const minutes = (value: string) => {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Uses the same field layout as extension credentials; connecting never opts into notices. */
export function ExtensionNotices({ item }: { item: ExtensionInfo }) {
  const [revision, setRevision] = useState(0);
  return <NoticeFields key={revision} item={item} onReload={() => setRevision((n) => n + 1)} />;
}
function useNoticeSettings(item: ExtensionInfo) {
  const [enabled, setEnabled] = useState(false);
  const [thread, setThread] = useState("home");
  const [quiet, setQuiet] = useState(false);
  const [start, setStart] = useState("22:00");
  const [end, setEnd] = useState("08:00");
  const [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [targets, setTargets] = useState<{ id: string; title: string | null }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError(false);
    client
      .call("extensions.events_get", { id: item.id })
      .then((result) => {
        if (!active) return;
        setTargets(result.targets);
        setSourceError(Boolean(result.error));
        const config = result.config;
        setEnabled(config?.enabled ?? false);
        setThread(config?.thread ?? "home");
        setQuiet(Boolean(config && config.quiet_start !== config.quiet_end));
        const hasQuiet = config && config.quiet_start !== config.quiet_end;
        setStart(clock(hasQuiet ? config.quiet_start : 1320));
        setEnd(clock(hasQuiet ? config.quiet_end : 480));
        if (config) setZone(config.time_zone);
        setLoaded(true);
      })
      .catch(() => {
        if (active) {
          setError(true);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
    };
  }, [item]);
  async function save() {
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      await client.call("extensions.events_set", {
        id: item.id,
        config: {
          enabled,
          thread,
          quiet_start: quiet ? minutes(start) : 0,
          quiet_end: quiet ? minutes(end) : 0,
          time_zone: zone,
        },
      });
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return {
    enabled,
    setEnabled,
    thread,
    setThread,
    quiet,
    setQuiet,
    start,
    setStart,
    end,
    setEnd,
    zone,
    setZone,
    targets,
    loaded,
    busy,
    error,
    saved,
    setSaved,
    sourceError,
    save,
  };
}
function NoticeFields({ item, onReload }: { item: ExtensionInfo; onReload: () => void }) {
  const t = useT();
  const {
    enabled,
    setEnabled,
    thread,
    setThread,
    quiet,
    setQuiet,
    start,
    setStart,
    end,
    setEnd,
    zone,
    setZone,
    targets,
    loaded,
    busy,
    error,
    saved,
    setSaved,
    sourceError,
    save,
  } = useNoticeSettings(item);
  return (
    <section className="mkt-settings__sec">
      <h3 className="mkt-settings__hint">{t("market.events.title")}</h3>
      <p className="mkt-settings__hint">{t("market.events.help")}</p>
      {!item.enabled && <p className="apx-muted">{t("market.events.connect")}</p>}
      {!loaded ? (
        <p className="apx-muted" role="status">
          {t("market.events.loading")}
        </p>
      ) : (
        <>
          <Switch
            label={t("market.events.enable")}
            checked={enabled}
            onCheckedChange={(v) => {
              setEnabled(v);
              setSaved(false);
            }}
            disabled={busy || !item.enabled}
          />
          {enabled && (
            <>
              <Field label={t("market.events.destination")}>
                <Select
                  label={t("market.events.destination")}
                  value={thread}
                  onValueChange={(v) => {
                    if (v) {
                      setThread(v);
                      setSaved(false);
                    }
                  }}
                  disabled={busy}
                  options={targets.map((target) => ({
                    value: target.id,
                    label: target.id === "home" ? t("market.events.home") : target.title || t("market.events.untitled"),
                  }))}
                />
              </Field>
              <Switch
                label={t("market.events.quiet")}
                checked={quiet}
                onCheckedChange={(v) => {
                  setQuiet(v);
                  setSaved(false);
                }}
                disabled={busy}
              />
              {quiet && (
                <>
                  <Field label={t("market.events.from")}>
                    {(id) => (
                      <Input
                        id={id}
                        type="time"
                        value={start}
                        onChange={(e) => {
                          setStart(e.target.value);
                          setSaved(false);
                        }}
                        disabled={busy}
                      />
                    )}
                  </Field>
                  <Field label={t("market.events.to")}>
                    {(id) => (
                      <Input
                        id={id}
                        type="time"
                        value={end}
                        onChange={(e) => {
                          setEnd(e.target.value);
                          setSaved(false);
                        }}
                        disabled={busy}
                      />
                    )}
                  </Field>
                  <Field label={t("market.events.zone")}>
                    {(id) => (
                      <Input
                        id={id}
                        value={zone}
                        onChange={(e) => {
                          setZone(e.target.value);
                          setSaved(false);
                        }}
                        disabled={busy}
                        placeholder="Europe/Madrid"
                      />
                    )}
                  </Field>
                </>
              )}
            </>
          )}
          {sourceError && (
            <p className="apx-muted" role="status">
              {t("market.events.sourceError")}
            </p>
          )}
          {error && <p role="alert">{t("market.events.error")}</p>}
          {saved && <p role="status">{t("market.events.saved")}</p>}
          <Button
            size="sm"
            loading={busy}
            disabled={!item.enabled || !targets.length || (enabled && quiet && (!start || !end || !zone.trim()))}
            onClick={() => void save()}
          >
            {t("common.save")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setSaved(false);
              onReload();
            }}
          >
            {t("market.events.reload")}
          </Button>
        </>
      )}
    </section>
  );
}
