import { WidgetRow } from "./WidgetRow";
import type { DeckDesktop, DeckWidget } from "../../lib/api/deck";

interface DesktopGroupProps {
  desktop: DeckDesktop;
  widgets: DeckWidget[];
  onToggle: (widgetId: string, enabled: boolean) => Promise<void>;
}

export function DesktopGroup({ desktop, widgets, onToggle }: DesktopGroupProps) {
  if (widgets.length === 0) return null;

  return (
    <div data-testid={`deck-desktop-${desktop.id}`} className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-fg">
        {desktop.title}
      </h3>
      <ul className="space-y-1.5">
        {widgets.map((w) => (
          <WidgetRow
            key={w.id}
            widget={w}
            onToggle={
              w.source === "external"
                ? (enabled) => onToggle(w.id, enabled)
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}
