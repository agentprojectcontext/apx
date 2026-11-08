import { IconButton, Icons, Menu } from "@apx/ui";
import { activeCommandsOf } from "../data/jobs.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go, type PanelKind, useNav } from "../shell/nav.ts";
import { PANELS, panelDef } from "./panels.tsx";
import { delegationRunning } from "./process-scope.ts";

/** The tools with something running for this chat now: its commands, the agents it called. */
function useLive(thread: string | undefined): ReadonlySet<PanelKind> {
  const commands = useData((s) => !!thread && activeCommandsOf(s.jobs.running, thread).length > 0);
  const agents = useData((s) => !!thread && delegationRunning(s.jobs.running, s.threads, thread));
  return new Set<PanelKind>([...(commands ? ["processes" as const] : []), ...(agents ? ["agents" as const] : [])]);
}

/** Chat header control that picks the side panel: inline icons when wide, one dropdown when narrow. */
export function PanelSwitcher({ wide, skipUsage = false }: { wide: boolean; skipUsage?: boolean }) {
  const t = useT();
  const panel = useNav((s) => s.panel);
  const live = useLive(useNav((s) => s.threadId));
  const shown = PANELS.filter((p) => !(skipUsage && p.id === "usage"));
  if (wide) {
    return (
      <div className="panelswitch">
        {shown.map((p) => (
          <IconButton
            key={p.id}
            size="sm"
            label={t(p.label)}
            tooltip={t(p.hint)}
            icon={
              live.has(p.id) && panel !== p.id ? (
                <>
                  {p.icon(14)}
                  <span className="panelswitch__live" aria-hidden="true" />
                </>
              ) : (
                p.icon(14)
              )
            }
            className={panel === p.id ? "panelswitch__btn is-on" : "panelswitch__btn"}
            onClick={() => go.togglePanel(p.id)}
          />
        ))}
      </div>
    );
  }
  const current = panel ? panelDef(panel) : undefined;
  return (
    <Menu
      align="end"
      items={[
        ...shown.map((p) => ({
          label: t(p.label),
          icon: p.icon(14),
          onSelect: () => go.panel(p.id),
        })),
        ...(panel
          ? [
              { type: "separator" as const },
              { label: t("panel.close"), icon: <Icons.X size={14} />, onSelect: () => go.panel(null) },
            ]
          : []),
      ]}
      trigger={
        <button
          type="button"
          className={panel ? "panelswitch__menu is-on" : "panelswitch__menu"}
          aria-label={current ? t("panel.current", { name: t(current.label) }) : t("panel.open")}
          title={current ? t("panel.current", { name: t(current.label) }) : t("panel.open")}
        >
          {current ? current.icon(14) : <Icons.Globe size={14} />}
          <Icons.ChevronDown size={12} />
        </button>
      }
    />
  );
}
