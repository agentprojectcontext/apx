import type { ExtensionInfo, ExtensionPower } from "@apx/protocol";
import { Badge, Icons } from "@apx/ui";
import { type MessageKey, useT } from "../i18n/index.ts";

// What an extension is and brings, the same in the install dialog and in its card under Extensions.

/** One thing it may do, in the owner's words. */
export function usePowerText(): (p: ExtensionPower) => string {
  const t = useT();
  return (p) => t(`extPower.${p.kind}` as MessageKey, { name: p.kind === "secret" ? (p.detail ?? p.name) : p.name });
}

/** Oficial or De terceros, by its files. */
function ProvenanceBadge({ e }: { e: Pick<ExtensionInfo, "provenance"> }) {
  const t = useT();
  return e.provenance === "official" ? (
    <Badge tone="brand" dot>
      {t("ext.official")}
    </Badge>
  ) : (
    <Badge tone="neutral" dot>
      {t("ext.thirdParty")}
    </Badge>
  );
}

export function ExtensionSummary({ e }: { e: ExtensionInfo }) {
  const t = useT();
  return (
    <>
      <div className="pcard__top">
        <div className="pcard__titles">
          <div className="pcard__name">
            {e.name} <span className="svc__dialect">v{e.version}</span> <ProvenanceBadge e={e} />
          </div>
          <div className="pcard__id">
            {e.id} · {e.hash}
          </div>
        </div>
      </div>
      {e.description && <p className="config__lead">{e.description}</p>}
      <dl className="pcard__rows">
        <dt>{t("ext.skills")}</dt>
        <dd>{e.skills.join(", ") || "—"}</dd>
        <dt>{t("ext.mcp")}</dt>
        <dd>{e.mcp.join(", ") || "—"}</dd>
        {e.plugin && (
          <>
            <dt>{t("ext.plugin")}</dt>
            <dd>
              {[
                e.plugin.observe.length ? t("ext.plugin.watches", { events: e.plugin.observe.join(", ") }) : "",
                e.plugin.context ? t("ext.plugin.context") : "",
                e.plugin.network ? t(e.plugin.local_network ? "ext.plugin.localNetwork" : "ext.plugin.network") : "",
              ]
                .filter(Boolean)
                .join(" · ") || "—"}
            </dd>
          </>
        )}
        <dt>{t("ext.source")}</dt>
        <dd>{e.source}</dd>
      </dl>
      {e.runs_code && (
        <p className="pform__hint">
          <Icons.TriangleAlert size={12} /> {t("ext.runsCode")}
        </p>
      )}
      {e.plugin?.status === "error" && (
        <Badge tone="danger" dot>
          {t("ext.plugin.error", { error: e.plugin.error ?? "" })}
        </Badge>
      )}
    </>
  );
}
