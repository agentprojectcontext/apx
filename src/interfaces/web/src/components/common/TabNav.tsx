// Left-rail tab nav used inside Settings + per-project screens. Mirrors
// the panda.project sectioned-nav pattern: optional section title above
// each group, icon + label rows, active state in the section's tone.
import { useState, useEffect, useCallback, Fragment, type ElementType, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { cn } from "../../lib/cn";
import { Tip } from "../ui/tip";
import { t } from "../../i18n";

export interface TabItem {
  key: string;
  label: string;
  icon: ElementType;
  badge?: string | number;
  // Small decoration (e.g. an Obsidian mark on "Memories" when the vault is
  // wired) — trailing when expanded, a corner overlay when collapsed.
  mark?: ReactNode;
}

export interface TabSection {
  title?: string;
  items: TabItem[];
}

interface TabNavProps {
  sections: TabSection[];
  active: string;
  onChange: (key: string) => void;
  collapsed?: boolean;
}

// Collapsed state lives in the screen (so the toggle can render in the page
// header). Persisted per-screen in localStorage.
export function useNavCollapse(storageKey: string) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try { setCollapsed(localStorage.getItem(storageKey) === "true"); } catch { /* ignore */ }
  }, [storageKey]);

  const toggle = useCallback(() =>
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(storageKey, String(next)); } catch { /* quota */ }
      return next;
    }), [storageKey]);

  return { collapsed, toggle };
}

export function NavToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <Tip content={collapsed ? t("settings_ui.expand_menu") : t("settings_ui.collapse_menu")} side="bottom">
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? t("settings_ui.expand_menu") : t("settings_ui.collapse_menu")}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-fg transition-colors hover:bg-accent hover:text-foreground"
      >
        <PanelLeft className={cn("size-4 transition-transform", collapsed && "rotate-180")} />
      </button>
    </Tip>
  );
}

export function TabNav({ sections, active, onChange, collapsed = false }: TabNavProps) {
  return (
    <nav
      className={cn(
        "hidden md:flex shrink-0 flex-col gap-1 py-3 transition-all",
        collapsed ? "w-12 items-center px-1" : "w-44 px-2",
      )}
    >
      {sections.map((section, si) => (
        <div key={si} className={cn("w-full", si > 0 && "mt-2")}>
          {!collapsed && section.title && (
            <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-wider text-muted-fg/70">
              {section.title}
            </p>
          )}
          <div className="space-y-0.5">
            {section.items.map(({ key, label, icon: Icon, badge, mark }) => {
              const isActive = active === key;
              const btn = (
                <button
                  type="button"
                  onClick={() => onChange(key)}
                  data-testid={`tabnav-${key || "index"}`}
                  className={cn(
                    "relative flex cursor-pointer items-center rounded-lg transition-colors",
                    collapsed ? "size-9 justify-center" : "w-full gap-2 px-2.5 py-1.5",
                    isActive
                      ? "bg-accent text-accent-fg"
                      : "text-muted-fg hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {collapsed && mark && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-card">{mark}</span>
                  )}
                  {!collapsed && (
                    <>
                      <span className="flex-1 truncate text-left text-xs">{label}</span>
                      {mark && <span className="flex shrink-0 items-center">{mark}</span>}
                      {badge !== undefined && (
                        <span className="rounded-full bg-muted px-1.5 text-[9px] text-muted-fg">{badge}</span>
                      )}
                    </>
                  )}
                </button>
              );
              return collapsed
                ? <Tip key={key} content={label} side="right">{btn}</Tip>
                : <Fragment key={key}>{btn}</Fragment>;
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
