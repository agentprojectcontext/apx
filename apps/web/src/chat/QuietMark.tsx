import { Badge, Icons } from "@apx/ui";
import { useT } from "../i18n/index.ts";

/**
 * Nothing worth telling: the agent answered SKIP, or a routine ran without calling the model. One badge wherever that
 * shows (a run's line, its chat, a list's preview), so a skip reads as what it is.
 */
export function QuietBadge({ className }: { className?: string }) {
  const t = useT();
  return (
    <Badge tone="neutral" variant="outline" className={className ? `quietbadge ${className}` : "quietbadge"}>
      <Icons.BellOff size={11} aria-hidden="true" />
      {t("quiet.label")}
    </Badge>
  );
}

/** The badge as a line of the chat, with what it means when there is more to say ("The model was not called"). */
export function QuietMark({ note }: { note?: string | undefined }) {
  return (
    <div className="quietmark" role="status">
      <QuietBadge />
      {note && <span className="quietmark__note">{note}</span>}
    </div>
  );
}
