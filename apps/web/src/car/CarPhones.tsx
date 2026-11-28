import type { CarPhone } from "@apx/protocol";
import { Button, EmptyState, Icons, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { useT } from "../i18n/index.ts";

/** The phones that use errands on the way, each with what it is doing and a way to turn it off from here. */
export function CarPhones() {
  const t = useT();
  const [phones, setPhones] = useState<CarPhone[]>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const load = useCallback(() => {
    void client.call("car.phones", {}).then(
      (r) => {
        setPhones(r.phones);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);
  useEffect(() => {
    load();
    return watchEvents((ev) => {
      if (ev.type === "car.updated") load();
    });
  }, [load]);
  const turnOff = (phone: CarPhone) => {
    setBusy(phone.device_id);
    void client
      .call("car.phone", { device_id: phone.device_id, enabled: false })
      .then(
        (next) => setPhones((list) => list?.map((p) => (p.device_id === next.device_id ? next : p))),
        () => setFailed(true),
      )
      .finally(() => setBusy(undefined));
  };
  if (!phones)
    return failed ? (
      <p role="alert" className="config__lead">
        {t("car.loadError")}
      </p>
    ) : (
      <Skeleton height={56} shape="block" />
    );
  if (!phones.length)
    return (
      <EmptyState variant="dashed" size="sm" icon={<Icons.Smartphone />} title={t("car.phonesEmptyTitle")}>
        {t("car.phonesEmpty")}
      </EmptyState>
    );
  return (
    <>
      {failed && (
        <p role="alert" className="config__lead">
          {t("car.saveError")}
        </p>
      )}
      <ul className="car__list" aria-label={t("car.phones")}>
        {phones.map((p) => (
          <li key={p.device_id} className="car__row">
            <div className="car__rowmain">
              <span className="car__rowtitle">{p.name}</span>
              <span className="car__rowmeta">
                {p.trip
                  ? t("car.phoneDriving")
                  : p.enabled
                    ? t("car.phoneEnabled")
                    : p.changed_by === "owner"
                      ? t("car.phoneOffHere")
                      : t("car.phoneOffThere")}
              </span>
            </div>
            {p.enabled && (
              <div className="car__rowactions">
                <Button size="sm" variant="secondary" loading={busy === p.device_id} onClick={() => turnOff(p)}>
                  {t("car.phoneTurnOff")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
