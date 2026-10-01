import { IconButton, Icons, Menu } from "@apx/ui";
import { useT } from "../i18n/index.ts";
import { go, useNav } from "../shell/nav.ts";
import { PANELS, panelDef } from "./panels.tsx";

/** Chat header control that picks the side panel: inline icons when wide, one dropdown when narrow. */
export function PanelSwitcher({ wide }: { wide: boolean }) {
  const t = useT();
  const panel = useNav((s) => s.panel);
  if (wide) {
    return (
      <div className="panelswitch">
        {PANELS.map((p) => (
          <IconButton
            key={p.id}
            label={t(p.label)}
            icon={p.icon(16)}
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
        ...PANELS.map((p) => ({
          label: t(p.label),
          icon: p.icon(16),
          onSelect: () => go.panel(p.id),
        })),
        ...(panel
          ? [
              { type: "separator" as const },
              { label: t("panel.close"), icon: <Icons.X size={16} />, onSelect: () => go.panel(null) },
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
          {current ? current.icon(16) : <Icons.Globe size={16} />}
          <Icons.ChevronDown size={12} />
        </button>
      }
    />
  );
}
