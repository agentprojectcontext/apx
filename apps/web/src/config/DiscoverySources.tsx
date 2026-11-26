import type { DiscoverySettings, Project } from "@apx/protocol";
import { Button, Disclosure, Field, Input, Select, Textarea } from "@apx/ui";
import { useRef } from "react";
import { useT } from "../i18n/index.ts";

type Source = DiscoverySettings["sources"][number];
export function DiscoverySources({
  value,
  projects,
  change,
}: {
  value: Source[];
  projects: Project[];
  change: (sources: Source[]) => void;
}) {
  const t = useT();
  const keys = useRef(new WeakMap<Source, string>());
  const key = (source: Source) => {
    let id = keys.current.get(source);
    if (!id) {
      id = crypto.randomUUID();
      keys.current.set(source, id);
    }
    return id;
  };
  const replace = (source: Source, patch: Partial<Source>) => {
    const next = { ...source, ...patch };
    keys.current.set(next, key(source));
    change(value.map((s) => (s === source ? next : s)));
  };
  return (
    <Disclosure title={t("discovery.extraSources")} description={t("discovery.sourceHint")}>
      <div className="discovery__stack">
        {value.map((source) => (
          <Disclosure
            key={key(source)}
            title={source.label || t("discovery.sourceName")}
            defaultOpen
            trailing={
              <Button size="sm" variant="ghost" onClick={() => change(value.filter((s) => s !== source))}>
                {t("discovery.removeSource")}
              </Button>
            }
          >
            <div className="discovery__stack">
              <Field label={t("discovery.sourceName")}>
                {(id) => (
                  <Input
                    id={id}
                    required
                    maxLength={120}
                    value={source.label}
                    onChange={(e) => replace(source, { label: e.currentTarget.value })}
                  />
                )}
              </Field>
              <Field label={t("discovery.sourceProject")}>
                <Select
                  label={t("discovery.sourceProject")}
                  value={source.project ?? ""}
                  options={[
                    { value: "", label: t("discovery.general") },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  onValueChange={(project) => replace(source, { project: project || undefined })}
                />
              </Field>
              <Field label={t("discovery.sourcePages")}>
                {(id) => (
                  <Textarea
                    id={id}
                    required
                    rows={3}
                    defaultValue={source.pages.join("\n")}
                    maxLength={16000}
                    onBlur={(e) =>
                      replace(source, {
                        pages: e.currentTarget.value
                          .split("\n")
                          .map((url) => url.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                )}
              </Field>
              <Field label={t("discovery.searchTerms")} hint={t("discovery.searchTermsHint")}>
                {(id) => (
                  <Input
                    id={id}
                    maxLength={120}
                    value={source.public_terms}
                    onChange={(e) => replace(source, { public_terms: e.currentTarget.value })}
                  />
                )}
              </Field>
            </div>
          </Disclosure>
        ))}
        <Button
          variant="secondary"
          disabled={value.length >= 100}
          onClick={() => change([...value, { label: "", pages: [], public_terms: "" }])}
        >
          {t("discovery.addSource")}
        </Button>
      </div>
    </Disclosure>
  );
}
