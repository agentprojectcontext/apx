import type { MailCheck as Check } from "@apx/protocol";
import { CHECK_EVERY } from "@apx/protocol/client";
import { SettingRow, Skeleton, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { SubHead } from "../config/SectionHead.tsx";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { Duration } from "./Duration.tsx";

/**
 * Gmail's mail check: whether new mail is looked at, how often, and whether only what Gmail marks important. It reads
 * the inbox only with the owner's own Google client (`readable`).
 */
export function MailCheck({ id, readable }: { id: string; readable: boolean }) {
  const t = useT();
  const [saved, setSaved] = useState<Check>();
  useEffect(() => {
    client
      .call("integrations.settings", { id })
      .then((r) => setSaved(r.mail))
      .catch((e: unknown) => notify(t("error.load", { error: e instanceof Error ? e.message : String(e) })));
  }, [id, t]);
  const save = async (change: Partial<Check>) => {
    try {
      setSaved((await client.call("integrations.configure", { id, mail: change })).mail);
    } catch (e) {
      notify(t("error.change", { error: e instanceof Error ? e.message : String(e) }));
    }
  };
  const off = !saved?.enabled || !readable;
  return (
    <section aria-label={t("int.mail.title")}>
      <SubHead>{t("int.mail.title")}</SubHead>
      {!readable && <p className="pform__hint">{t("int.mail.ownClient")}</p>}
      {!saved ? (
        <Skeleton height={140} />
      ) : (
        <>
          <SettingRow title={t("int.mail.check")} description={t("int.mail.checkHint")}>
            <Switch
              aria-label={t("int.mail.check")}
              checked={saved.enabled}
              disabled={!readable}
              onCheckedChange={(enabled) => void save({ enabled })}
            />
          </SettingRow>
          <SettingRow title={t("int.mail.every")} description={t("int.mail.everyHint")}>
            <Duration
              key={saved.every_min}
              label={t("int.mail.every")}
              minutes={saved.every_min}
              range={CHECK_EVERY}
              units={["min", "h"]}
              disabled={off}
              onSave={(every_min) => void save({ every_min })}
            />
          </SettingRow>
          <SettingRow title={t("int.mail.important")} description={t("int.mail.importantHint")}>
            <Switch
              aria-label={t("int.mail.important")}
              checked={saved.important_only}
              disabled={off}
              onCheckedChange={(important_only) => void save({ important_only })}
            />
          </SettingRow>
        </>
      )}
    </section>
  );
}
