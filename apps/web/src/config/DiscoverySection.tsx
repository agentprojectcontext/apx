import { Button, Dialog, SettingRow, Skeleton, Switch } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { useOwnerTimeZone } from "../data/owner.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { DiscoveryCoverage } from "./DiscoveryCoverage.tsx";
import { DiscoveryFindings } from "./DiscoveryFindings.tsx";
import { DiscoveryForm } from "./DiscoveryForm.tsx";
import { SaveBar } from "./SaveBar.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { useDiscovery } from "./useDiscovery.ts";
import "./discovery.css";
import "@apx/ui/disclosure.css";

export function DiscoverySection() {
  const t = useT();
  const model = useDiscovery();
  const { status, draft, error, busy, dirty } = model;
  const owned = useOwnerTimeZone();
  const [reload, setReload] = useState(false);
  const doReload = () => {
    model.load();
    setReload(false);
  };
  const problemRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) {
      problemRef.current?.focus();
      problemRef.current?.scrollIntoView({ block: "center" });
    }
  }, [error]);
  const problem = error && (
    <div ref={problemRef} tabIndex={-1} className="discovery__problem">
      <p role="alert">
        {t(
          error === "conflict"
            ? "discovery.conflict"
            : error === "load"
              ? "discovery.loadError"
              : "discovery.saveError",
        )}
      </p>
      <Button variant="secondary" onClick={() => (dirty && draft ? setReload(true) : doReload())}>
        {t(error === "load" ? "discovery.retry" : "discovery.reload")}
      </Button>
    </div>
  );
  if (!draft || !status)
    return (
      <>
        <SectionHead title={t("discovery.title")} lead={t("discovery.lead")} />
        {problem || <Skeleton height={240} shape="block" />}
      </>
    );
  const on = status.settings.enabled;
  // The core follows the profile's time zone; the research's own one only covers a profile without it.
  const zone = { value: owned || status.settings.timezone, mine: !!owned };
  return (
    <>
      <SectionHead title={t("discovery.title")} lead={t("discovery.lead")} />
      <SettingRow title={t("discovery.enabled")} description={t(on ? "discovery.cost" : "discovery.off")}>
        <Switch
          checked={draft.enabled}
          disabled={busy}
          onCheckedChange={(enabled) => void model.turn(enabled)}
          aria-label={t("discovery.enabled")}
        />
      </SettingRow>
      {!on && problem}
      {on && !status.available && (
        <SettingRow title={t("discovery.needsModel")} description={t("discovery.needsModelHint")}>
          <Button size="sm" variant="secondary" onClick={() => go.config("helper-model")}>
            {t("discovery.chooseModel")}
          </Button>
        </SettingRow>
      )}
      {on && (
        <>
          <form
            className="discovery__stack"
            onInvalidCapture={(event) => {
              if (event.target instanceof HTMLElement) {
                const details = event.target.closest("details");
                if (details) details.open = true;
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void model.save();
            }}
          >
            <fieldset disabled={busy} className="discovery__fieldset">
              <DiscoveryForm
                draft={draft}
                change={model.setDraft}
                projects={model.projects}
                reports={model.reports}
                zone={zone}
                routinesChanged={model.routinesChanged}
              />
            </fieldset>
            {problem}
            <SaveBar dirty={dirty} saving={busy} saved={model.saved} onDiscard={model.discard} />
          </form>
          <DiscoveryCoverage status={status} zone={zone.value} busy={busy} refresh={model.refresh} />
          <DiscoveryFindings status={status} zone={zone.value} update={model.setStatus} />
        </>
      )}
      <Dialog
        open={reload}
        onOpenChange={setReload}
        title={t("discovery.discard")}
        closeLabel={t("discovery.cancel")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReload(false)}>
              {t("discovery.cancel")}
            </Button>
            <Button onClick={doReload}>{t("discovery.reload")}</Button>
          </>
        }
      />
    </>
  );
}
