import { Button, Dialog, Skeleton } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { DiscoveryCoverage } from "./DiscoveryCoverage.tsx";
import { DiscoveryFindings } from "./DiscoveryFindings.tsx";
import { DiscoveryForm } from "./DiscoveryForm.tsx";
import { SectionHead } from "./SectionHead.tsx";
import { useDiscovery } from "./useDiscovery.ts";
import "./discovery.css";
import "@apx/ui/disclosure.css";

export function DiscoverySection() {
  const t = useT();
  const model = useDiscovery();
  const { status, draft, error, busy, dirty } = model;
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
  return (
    <>
      <SectionHead title={t("discovery.title")} lead={t("discovery.lead")} />
      {(!draft || !status) && problem}
      {!draft || !status ? (
        error ? null : (
          <Skeleton height={240} shape="block" />
        )
      ) : (
        <>
          <p role="status" className="config__lead">
            {t(
              !status.available && status.settings.enabled
                ? "discovery.unavailable"
                : status.settings.enabled
                  ? "discovery.active"
                  : "discovery.paused",
            )}
          </p>
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
                routines={model.routines}
              />
            </fieldset>
            {problem}
            <div className="discovery__actions">
              <Button type="submit" loading={busy} disabled={busy || !dirty}>
                {t("discovery.save")}
              </Button>
              {model.saved && !dirty && <span role="status">{t("discovery.saved")}</span>}
            </div>
          </form>
          <DiscoveryCoverage status={status} busy={busy} refresh={model.refresh} />
          <DiscoveryFindings status={status} update={model.setStatus} />
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
