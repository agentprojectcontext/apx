import type { DiscoveryStatus } from "@apx/protocol";
import { Button, Disclosure } from "@apx/ui";
import { currentLocale, type MessageKey, useT } from "../i18n/index.ts";

const REASONS: Record<DiscoveryStatus["inaccessible"][number]["kind"], MessageKey> = {
  unreadable: "discovery.sourceUnreadable",
  changed_site: "discovery.sourceChanged",
  search_unavailable: "discovery.searchUnavailable",
  unverified: "discovery.sourceUnverified",
};

export function DiscoveryCoverage({
  status,
  zone,
  busy,
  refresh,
}: {
  status: DiscoveryStatus;
  /** The time zone research runs in, for the dates shown. */
  zone: string;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const t = useT();
  const date = (value: string) =>
    new Date(value).toLocaleString(currentLocale(), {
      timeZone: zone,
      dateStyle: "medium",
      timeStyle: "short",
    });
  const scheduled = status.settings.enabled && status.available && status.state !== "uncertain";
  return (
    <>
      <div className="discovery__coverage">
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void refresh()}>
          {t("discovery.refresh")}
        </Button>
        <p>
          {status.last_at
            ? t("discovery.coverage", {
                done: status.coverage.filter((p) => p.reviewed_at).length,
                total: status.coverage.length,
              })
            : t("discovery.notYet")}
        </p>
        {status.last_at && (
          <>
            <p>{t("discovery.planned", { count: status.coverage.filter((p) => p.planned_at).length })}</p>
            <p>{t("discovery.researched", { count: status.coverage.filter((p) => p.researched_at).length })}</p>
          </>
        )}
        {status.state === "working" && <p role="status">{t("discovery.working")}</p>}
        {scheduled && status.next_at && <p>{t("discovery.nextReview", { date: date(status.next_at) })}</p>}
        {scheduled && status.deep_next_at && <p>{t("discovery.nextResearch", { date: date(status.deep_next_at) })}</p>}
        {status.state === "failed" && <p role="status">{t("discovery.failed")}</p>}
        {status.state === "uncertain" && <p role="status">{t("discovery.uncertain")}</p>}
      </div>
      {!!status.inaccessible.length && (
        <Disclosure title={t("discovery.inaccessible")}>
          {status.inaccessible.map((item) => (
            <p key={`${item.url}:${item.kind}`} className="discovery__sourceFailure">
              <strong>{item.url === "search" ? t("discovery.publicSearch") : item.url}</strong>
              <br />
              {t(REASONS[item.kind])}
            </p>
          ))}
        </Disclosure>
      )}
    </>
  );
}
