import type { DiscoveryFinding, DiscoveryStatus } from "@apx/protocol";
import { Button, Card, Dialog, Disclosure, EmptyState, Icons } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { currentLocale, useT } from "../i18n/index.ts";
import { SubHead } from "./SectionHead.tsx";

export function DiscoveryFindings({
  status,
  update,
}: {
  status: DiscoveryStatus;
  update: (status: DiscoveryStatus) => void;
}) {
  const t = useT();
  const [mute, setMute] = useState<DiscoveryFinding>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"saved" | "error">();
  const rate = async (finding: Pick<DiscoveryFinding, "id">, feedback: "useful" | "not_useful" | "mute" | "unmute") => {
    setBusy(true);
    setNotice(undefined);
    try {
      update(await client.call("discovery.feedback", { finding: finding.id, feedback }));
      setNotice("saved");
      setMute(undefined);
    } catch {
      setNotice("error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="discovery__stack" aria-label={t("discovery.findings")}>
      <SubHead>{t("discovery.findings")}</SubHead>
      {notice && (
        <p role={notice === "error" ? "alert" : "status"}>
          {t(notice === "error" ? "discovery.feedbackError" : "discovery.thanks")}
        </p>
      )}
      {!status.findings.length && (
        <EmptyState variant="dashed" icon={<Icons.Globe />}>
          {t("discovery.empty")}
        </EmptyState>
      )}
      {status.findings
        .slice()
        .reverse()
        .map((finding) => (
          <Card
            key={finding.id}
            title={finding.title}
            description={t(
              finding.included_at
                ? "discovery.included"
                : Date.parse(finding.expires_at) < Date.now()
                  ? "discovery.expired"
                  : "discovery.pending",
            )}
          >
            <p>{finding.summary}</p>
            <p>{finding.action}</p>
            {finding.uncertainty && <p className="config__lead">{finding.uncertainty}</p>}
            <h4>{t("discovery.evidence")}</h4>
            {finding.evidence.map((evidence) => (
              <div key={`${evidence.url}:${evidence.quote}`} className="discovery__evidence">
                <a
                  href={/^https?:\/\//.test(evidence.url) ? evidence.url : undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {evidence.title || new URL(evidence.url).hostname}
                </a>
                <small>
                  {t("discovery.readAt", {
                    date: new Date(evidence.read_at).toLocaleString(currentLocale(), {
                      timeZone: status.settings.timezone,
                    }),
                  })}
                </small>
                <blockquote>{evidence.quote}</blockquote>
              </div>
            ))}
            <div className="discovery__actions">
              <Button
                size="sm"
                variant={finding.feedback === "useful" ? "primary" : "secondary"}
                aria-pressed={finding.feedback === "useful"}
                disabled={busy || finding.feedback === "mute"}
                onClick={() => void rate(finding, "useful")}
              >
                {t("discovery.useful")}
              </Button>
              <Button
                size="sm"
                variant={finding.feedback === "not_useful" ? "primary" : "secondary"}
                aria-pressed={finding.feedback === "not_useful"}
                disabled={busy || finding.feedback === "mute"}
                onClick={() => void rate(finding, "not_useful")}
              >
                {t("discovery.notUseful")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => (finding.feedback === "mute" ? void rate(finding, "unmute") : setMute(finding))}
              >
                {t(finding.feedback === "mute" ? "discovery.unmute" : "discovery.mute")}
              </Button>
            </div>
          </Card>
        ))}
      {!!status.muted_topics.length && (
        <Disclosure title={t("discovery.mutedTopics")}>
          <ul className="discovery__stack">
            {status.muted_topics.map((topic) => (
              <li className="discovery__actions" key={topic.id}>
                <span>{topic.title}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`${t("discovery.unmute")}: ${topic.title}`}
                  onClick={() => void rate(topic, "unmute")}
                >
                  {t("discovery.unmute")}
                </Button>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <Dialog
        open={!!mute}
        onOpenChange={(open) => !open && !busy && setMute(undefined)}
        title={t("discovery.muteTitle")}
        description={t("discovery.muteHint")}
        closeLabel={t("discovery.cancel")}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setMute(undefined)}>
              {t("discovery.cancel")}
            </Button>
            <Button loading={busy} onClick={() => mute && void rate(mute, "mute")}>
              {t("discovery.mute")}
            </Button>
          </>
        }
      >
        {mute?.title}
      </Dialog>
    </section>
  );
}
