import { Button, Checkbox, EmptyState, Icons, SearchField, SegmentedControl } from "@apx/ui";
import { useEffect, useState } from "react";
import { cookieDomains, cookieSources, importCookies } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";
import { SectionHead } from "./SectionHead.tsx";

type Source = Awaited<ReturnType<typeof cookieSources>>[number];
type Domain = Awaited<ReturnType<typeof cookieDomains>>[number];

const BROWSER_NAMES: Record<string, string> = {
  zen: "Zen",
  firefox: "Firefox",
  chrome: "Chrome",
  brave: "Brave",
  arc: "Arc",
  edge: "Edge",
};

/** Browser: copy sessions from a local browser into APX's shared profile (runs in the desktop app). */
export function BrowserSection() {
  const t = useT();
  return (
    <>
      <SectionHead title={t("config.browser")} lead={t("browser.cfg.lead")} />
      <SessionsImport />
    </>
  );
}

function SessionsImport() {
  const t = useT();
  const [sources, setSources] = useState<Source[]>();
  const [source, setSource] = useState<string>();
  const [filter, setFilter] = useState("");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void cookieSources().then((s) => {
      setSources(s);
      setSource(s[0]?.id);
    });
  }, []);
  useEffect(() => {
    if (!source) return;
    const t = setTimeout(() => void cookieDomains(source, filter).then(setDomains), 200);
    return () => clearTimeout(t);
  }, [source, filter]);

  if (sources && !sources.length) {
    return (
      <EmptyState variant="dashed" icon={<Icons.Globe />} title={t("browser.cfg.noBrowsers")}>
        {t("browser.cfg.noBrowsersBody")}
      </EmptyState>
    );
  }
  const toggle = (d: string) =>
    setPicked((p) => {
      const n = new Set(p);
      n.has(d) ? n.delete(d) : n.add(d);
      return n;
    });
  return (
    <div className="config__section">
      <p className="config__hint">{t("browser.cfg.hint")}</p>
      <div className="config__row">
        <SegmentedControl
          size="sm"
          label={t("browser.cfg.source")}
          value={source}
          onValueChange={(v) => {
            setSource(v);
            setPicked(new Set());
          }}
          options={(sources ?? [])
            .slice(0, 4)
            .map((s) => ({ value: s.id, label: BROWSER_NAMES[s.browser] ?? s.browser }))}
        />
        <SearchField
          placeholder={t("browser.cfg.filter")}
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
      </div>
      <ul className="config__list">
        {domains.slice(0, 60).map((d) => (
          <li key={d.domain}>
            <Checkbox
              checked={picked.has(d.domain)}
              onCheckedChange={() => toggle(d.domain)}
              label={d.domain}
              description={t("browser.cfg.cookies", { n: d.count })}
            />
          </li>
        ))}
      </ul>
      <div className="config__actions">
        <Button
          disabled={!picked.size || !source}
          loading={busy}
          onClick={async () => {
            if (!source) return;
            setBusy(true);
            await importCookies(source, [...picked]);
            setBusy(false);
            setPicked(new Set());
          }}
        >
          {!picked.size
            ? t("browser.cfg.import")
            : picked.size === 1
              ? t("browser.cfg.importN.one")
              : t("browser.cfg.importN.other", { n: picked.size })}
        </Button>
      </div>
    </div>
  );
}
